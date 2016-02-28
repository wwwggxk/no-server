/*
 * Dependencies: event-stream, websocket, q, lodash
 *
 * Description: web static server
 * 1. web serve
 * 2. cross-domain proxy
 * 3. websocket and livereload feature
 * 4. rewriting resources local path
 *
 * Author: wungqiang@gmail.com
 */

var http = require('http'),
    https = require('https'),
    net = require('net'),
    crypto = require('crypto'),
    fs = require('fs'),
    os = require('os');
    q = require('q'),
    path = require('path'),
    util = require('util'),
    url = require('url'),
    lodash = require('lodash'),
    querystring = require('querystring'),
    childProcess = require('child_process'),

    eventStream = require('event-stream'),
    WebSocketServer = require('websocket').server;

function getIpAddress() {
    var ifaces = os.networkInterfaces(), ip = '';

    Object.keys(ifaces).forEach(function (ifname) {
        var alias = 0;

        ifaces[ifname].forEach(function (iface) {
            if ('IPv4' !== iface.family || iface.internal !== false) {
                // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
                return;
            }

            if (alias >= 1) {
                // this single interface has multiple ipv4 addresses
            } else {
                // this interface has only one ipv4 adress
            }
            ip = iface.address;
            ++alias;
        });
    });

    return ip;
}

/****************************************************************Proxy request*/
function Request(options) {
    this.options = options;
}

Request.prototype.onTimeout = function () {};

Request.prototype.onError = function () {};

/*
 * proxy config
 * suport http(s)://www.domain.com/{{proxyPath}}/otherPath?params=value
 * or     http(s)://www.domain.com/{{proxyPath?action={{proxyPath}}&params=value
 */
Request.parseOptions = function (target, route, proxy) {
    // reg:
    // [
    // 'match',
    // 'proxy address',
    // 'url parameter can be undefined(with &)',
    // 'url parameter can be undefined(without &)'
    // ]
    var reg=/action=([^&]+)(&(.+))*/,
        parsedUrl = url.parse(target),
        prefix = proxy,
        suffix = '',
        match, options, query;

    console.log('parsing proxy parameters...');
    if (reg.test(parsedUrl.query)) {
        match = parsedUrl.query.match(reg);
        prefix = decodeURIComponent(match[1]);
        if (match[3]) {
            query = match[3];
        }
    } else {
        suffix = parsedUrl.pathname.slice(parsedUrl.pathname.indexOf(route) +
            route.length);
        query = parsedUrl.query;
    }

    options = url.parse(prefix + suffix + (query ? ('?' + query) : ''));

    console.log('parse proxy parameters successfully');
    return options;
};

Request.prototype.request = function (callback, postData) {
    var agent, request, start;

    agent = this.options.protocol === 'https:' ? https : http;

    console.log('proxy requesting...');
    console.log(this.options);
    start = +new Date();
    request = agent.request(this.options, function (res) {
        console.log('proxy request successfully ' +
            res.statusCode + ' (' + (+new Date() - start)+'ms)');

        callback(res);
    });

    request.setTimeout(60 * 1000, this.onTimeout);
    request.on('error', this.onError);
    if (postData) {
        console.log('passing proxy parameters...');
        console.log(postData);
        request.write(postData);
    }
    request.end();
};

/************************************************************************Router*/
function Router(path, handler) {
    this.routes = {};
}

Router.prototype.when = function (url, handler) {
    this.routes[url] = {url: url, handle: handler};
    return this;
};

Router.prototype.proxy = function (url, proxyUrl, handler) {
    this.routes[url] = {url: url, handle: handler, proxy: proxyUrl};
    return this;
};

Router.prototype.rewrite = function (url, rewriteUrl, handler) {
    rewriteUrl = rewriteUrl.charAt(rewriteUrl.length - 1) === '/' ?
                 rewriteUrl :
                 rewriteUrl + '/';
    this.routes[url] = {url: url, handle: handler, rewrite: rewriteUrl};
    return this;
};

Router.prototype.other = function (handler) {
    this.defaultHandler = {url: '*', handle: handler};
    return this;
};

Router.prototype.remove = function (url) {
    delete this.routes[url];
    return this;
};

Router.prototype.getRoute = function (pathname) {
    for(var key in this.routes) {
        if (this.routes.hasOwnProperty(key) && !pathname.indexOf(key)) {
            return this.routes[key];
        }
    }

    return this.defaultHandler;
};

/********************************************************************WebServer*/
// TODO: multiple websocket client, max client count，whether refresh all clients
var Server = (function () {
    var injectScript = '<script>' +
        'if ("WebSocket" in window) {' +
            'var socketServer="ws://localhost:" + {{port}},' +
                'socket, protocol;' +

            'function reloadCss() {' +
                'var links = document.getElementsByTagName("link"),' +
                    'linksArr = Array.prototype.slice.call(links),' +
                    'reg = /(&|\\?)_key=.+/,' +
                    'keyQuery = "_key=" + Math.random(),' +
                    'i, link, url, parent;' +

                'for(i = 0; i < linksArr.length; i++) {' +
                    'link = linksArr[i];' +

                    'if (link.rel === "stylesheet" && link.href) {' +
                        'url = link.href.replace(reg, "");' +
                        'link.href = url + (url.indexOf("?") >= 0 ? "&" : "?") +' +
                                    '"_key=" + Math.random();' +
                    '}' +
                '}' +
            '}' +

            'socket = new WebSocket(socketServer);' +
            'socket.onmessage = function (msg) {' +
                'if (msg.data === "css") {' +
                    'return reloadCss();' +
                '}' +
                'if (msg.data === "all") {' +
                    'window.location.reload();' +
                '}' +
            '};' +
        '}' +
    '</script>';

    function openInBrowser(url) {
        childProcess.exec('open ' + url);
    }

    function cloneObj(obj) {
        function F() {}
        F.prototype = obj;
        return new F();
        if (!add || typeof add !== 'object') return origin;

        var keys = Object.keys(add);
        var i = keys.length;
        while (i--) {
            origin[keys[i]] = add[keys[i]];
        }
        return origin;
    }

    function bind(func, context) {
        if (func.bind) {
            return func.bind(context);
        }

        return function () {
            func.apply(context, arguments);
        };
    }

    function formatDateTime(date) {
        var hours, minutes, seconds, time;
        hours = date.getHours();
        minutes = date.getMinutes();
        seconds = date.getSeconds();

         minutes = minutes < 10 ? ('0' + minutes) : minutes;
         seconds = seconds < 10 ? ('0' + seconds) : seconds;

        time = hours + ':' + minutes + ':' + seconds;
        return '[' + (date.getMonth() + 1) + "/" + date.getDate() + "/" +
                date.getFullYear() + ' ' + time + ']';
    }

    function formatTime(date) {
        var hours, minutes, seconds, time;
        hours = date.getHours();
        minutes = date.getMinutes();
        seconds = date.getSeconds();

         minutes = minutes < 10 ? ('0' + minutes) : minutes;
         seconds = seconds < 10 ? ('0' + seconds) : seconds;

        time = hours + ':' + minutes + ':' + seconds;
        return '[' + time + ']';
    }

    function isPortAvailable(port, cb) {
        var server = net.createServer(), defer = q.defer();
        server.listen(port);
        server.on('error', function (e) {
            if (e.code === 'EADDRINUSE') {
                defer.reject();
            }
        });
        server.on('listening', function () {
            server.close();
            defer.resolve();
        });
        return defer.promise;
    }

    function S(root, options) {
        var _server, _wsServer, wsClient, self = this, isAbsolute,
            defaults = {
                root: '.',
                host: 'http://localhost',
                port: 9527,
                indexFile: 'index.html',
                browse: false,
                mime: {
                    ".css" : 'text/css',
                    ".js" : 'application/javascript',
                    ".gif": "image/gif",
                    ".jpeg": "image/jpeg",
                    ".jpg": "image/jpeg",
                    ".png": "image/png",
                    ".html": "text/html",
                    ".htm": "text/html"
                }
            };

        if (arguments.length === 1) {
            options = util.isObject(root) ? root : {
                root: root
            };
        }
        if (arguments.length === 2) {
            defaults.root = root;
        }

        lodash.extend(defaults, options || {});
        isAbsolute = path.resolve(root) == path.normalize(root);
        if (!isAbsolute) {
            defaults.root = path.join(path.dirname(module.parent.filename),
                            defaults.root);
        }
        this.options = defaults;
        this.router = new Router();
        this.route = null;
        this.pathname = '';
        this.start = function () {
            var defer = q.defer();

            // modify the port in injected scrpt
            injectScript = injectScript.replace('{{port}}', self.options.port);

            isPortAvailable(self.options.port).then(function () {
                _server = http.createServer(function (req, res) {
                    self.pathname = url.parse(req.url).pathname;
                    self.router.other(self.processStatic);
                    self.dispatch(req, res);

                });

                _server.on('listening', function () {
                    var date = formatTime(new Date()), ip  = getIpAddress();

                    _wsServer = createWsServer(_server);

                    console.log(date +
                            ' http server started: http://localhost:' +
                            self.options.port);
                    console.log(date +
                            ' http server started: http://' + ip + ':' +
                            self.options.port);

                    if (self.options.browse) {
                        openInBrowser(self.options.host + ':' + self.options.port);
                    }

                    defer.resolve(_server);
                });

                _server.listen(self.options.port);

                return defer.promise;
            }, function () {
                var msg = ('port:' + self.options.port + ' is used');
                console.log(msg);
                defer.reject(msg);
            });

            return defer.promise;
        };

        function createWsServer(server) {
            var wsServer;

            wsServer = new WebSocketServer({
                httpServer: server,
                autoAcceptConnections: false
            });

            wsServer.on('request', function (request) {
                var connection;
                if (request.origin === 'disallow') {
                    return request.reject();
                }

                wsClient = request.accept('', request.origin);
                console.log(formatTime(new Date()) +
                        ' new websocket client connected');
                wsClient.on('message', function (message) {
                    if (message.type === 'utf8') {
                        console.log('receive message: ' + message.utf8Data);
                        if (message.utf8Data === 'ping') {
                            wsClient.sendUTF('pong');
                        }
                    }
                });

            });
            return wsServer;
        }

        this.close = function () {
            _server.close();
            _wsServer.close();
        };

        this.reloadCss = function () {
            if (wsClient) {
                setTimeout(function () {
                    wsClient.sendUTF('css');
                }, 30);
            }
        };

        this.reloadAll = function () {
            if (wsClient) {
                wsClient.sendUTF('all');
            }
        };
    }

    S.prototype.dispatch = function (req, res) {
        this.route = this.router.getRoute(this.pathname);
        bind(this.route.handle, this)(req, res);
    };

    S.prototype.processProxy = function (req, res) {
        var postData = '', self = this;

        req.on('data', function (data) {
            postData += data;
            if (postData.length > 2 * 1000 * 1000) {
                postData = "";
                res.writeHead(413, {'Content-Type': 'text/plain'});
                res.end();
            }
        });

        req.on('end', function () {
            var options, agent, current, request, parsedUrl;

            options = Request.parseOptions(req.url, self.route.url,
                    self.route.proxy);
            options.method = req.method;
            request = new Request(options);
            options.headers = {
                'Content-Type': req.headers['content-type'] ||
                        'application/x-www-form-urlencoded'
            };

            if (req.headers.authorization) {
                options.headers.Authorization = req.headers.authorization;
            }

            request.onError = function () {
                console.log('proxy request failed');
                res.writeHead(500);
                res.end('proxy request failed');
            };

            request.onTimeout = function () {
                console.log('proxy request timeout');
                res.writeHead(500);
                res.end('proxy request timeout');
            };

            request.request(function (proxyRes) {
                proxyRes.pipe(res);
            }, postData);
        });
    };

    S.prototype.processStatic = function (req, res, pathname) {
        var self = this, tmp, index, prefix, relative;

        pathname = pathname || path.normalize(this.options.root +
                   this.pathname);

        if (this.route.rewrite) {
            tmp = pathname;
            index = pathname.indexOf(this.route.url, this.options.root.length);
            prefix = pathname.substring(0, index);
            relative = pathname.substring(index).replace(this.route.url,
                       this.route.rewrite);
            pathname = path.join(prefix, relative);
            console.log(formatTime(new Date()) + ' rewrite ' + tmp, pathname);
        }

        fs.exists(pathname, function (exists) {
            if (!exists) {
                console.log(formatTime(new Date()) + ' 404 ' + pathname);
                res.writeHead(404);
                return res.end('path not exists');
            }

            fs.access(pathname, fs.R_OK, function (err) {
                if (err) {
                    console.log(formatTime(new Date()) + ' 403 ' + pathname);
                    res.writeHead(403);
                    return res.end('permission denied');
                }

                fs.stat(pathname, function (err, stat) {
                    if (err) {
                        console.log(formatTime(new Date()) + ' 500 ' + pathname);
                        res.writeHead(500);
                        return res.end('server error occurs');
                    }

                    if (stat.isDirectory()) {
                        return self.processStatic(req, res,
                                path.normalize(path.join(pathname,
                                self.options.indexFile)));
                    }

                    res.setHeader('Content-Type',
                    self.options.mime[path.extname(pathname)] || 'text/html');

                    console.log(formatTime(new Date()) + ' 200 ' + pathname);
                    if (path.extname(pathname) !== '.html') {
                        return fs.createReadStream(pathname).pipe(res).end;
                    }

                    fs.createReadStream(pathname)
                    .pipe(eventStream.replace(/<\/body>/i,
                            injectScript + '<\/body>'))
                    .pipe(res);
                });
            });

        });
    };

    S.prototype.proxy = function (url, proxyUrl) {
        if (this.router) {
            this.router.proxy(url, proxyUrl, this.processProxy);
        }
    };

    S.prototype.rewrite = function (url, rewriteUrl) {
        if (this.router) {
            this.router.rewrite(url, rewriteUrl, this.processStatic);
        }
    };

    return S;
})();

module.exports = {
    create: function (path, options) {
        return new Server(path, options);
    }
};
