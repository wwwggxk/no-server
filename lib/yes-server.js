/*
 * Dependencies: event-stream, websocket
 *
 * Description: web静态服务器
 * 1. 支持静态web服务
 * 2. 支持跨域proxy
 * 3. 支持websocket及实时刷新css或者页面
 * 4. 支持重定向资源到本地文件
 *
 * Author: wungqiang@gmail.com
 */

var http = require('http'),
    https = require('https'),
    net = require('net'),
    crypto = require('crypto'),
    fs = require('fs'),
    path = require('path'),
    util = require('util'),
    url = require('url'),
    querystring = require('querystring'),
    childProcess = require('child_process'),

    eventStream = require('event-stream'),
    WebSocketServer = require('websocket').server;

function extendObj(target, options) {
    var p;
    target = target || {};
    for (p in options) {
        target[p] = options[p];
    }
}

/*********************************************************************代理请求*/
function Request(options) {
    this.options = options;
}

Request.prototype.onTimeout = function () {};

Request.prototype.onError = function () {};

/*
 * 代理配置
 * 支持http(s)://www.domain.com/{{proxyPath}}/otherPath?params=value
 * 或者http(s)://www.domain.com/{{proxyPath?action={{proxyPath}}&params=value
 */
Request.parseOptions = function (target, route, proxy) {
    // reg: ['匹配串', '代理地址', 'url参数可为undefined(有&)', '同前(无&)']
    var reg=/action=([^&]+)(&(.+))*/,
        parsedUrl = url.parse(target),
        prefix = proxy,
        suffix = '',
        match, options, query;

    console.log('代理参数解析...');
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

    console.log('解析代理参数完成');
    return options;
};

Request.prototype.request = function (callback, postData) {
    var agent, request, start;

    agent = this.options.protocol === 'https:' ? https : http;

    console.log('代理请求中...');
    console.log(this.options);
    start = +new Date();
    request = agent.request(this.options, function (res) {
        console.log('代理请求成功 ' +
            res.statusCode + ' (' + (+new Date() - start)+'毫秒)');

        callback(res);
    });

    request.setTimeout(60 * 1000, this.onTimeout);
    request.on('error', this.onError);
    if (postData) {
        console.log('代理数据写入...');
        console.log(postData);
        request.write(postData);
    }
    request.end();
};

/*************************************************************************路由*/
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
    if (pathname.length > 1) {
        for(var key in this.routes) {
            if (this.routes.hasOwnProperty(key) && !pathname.indexOf(key)) {
                return this.routes[key];
            }
        }
    }

    return this.defaultHandler;
};

/********************************************************************WebServer*/
// TODO: 保存多个websocket client, 设置上限值，设置是否刷新所有client
var Server = (function () {

    var defaults = {
        root: '.',
        host: 'http://localhost',
        port: 9527,
        indexFile: 'index.html',
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
    },
    injectScript = '<script>' +
        'if ("WebSocket" in window) {' +
            'var socketServer="ws://localhost:" + {{port}},' +
                'socket, protocol;' +

            'function reloadCss() {' +
                'var links = document.getElementsByTagName("link"),' +
                    'linksArr = Array.prototype.slice.call(links),' +
                    'reg = /(&|\?)_key=\d+/,' +
                    'keyQuery = "_key=" + new Date(),' +
                    'i, link, url;' +

                'for(i = 0; i < linksArr.length; i++) {' +
                    'link = linksArr[i];' +

                    'if (link.href) {' +
                        'url = link.href.replace(reg, "");' +
                        'link.href = url + (url.indexOf("?") >= 0 ? "&" : "?") +' +
                                    'keyQuery;' +
                    '}' +

                    'link.parentNode.removeChild(link).appendChild(link);' +
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


    function cascade(cbs, cb) {
        (function next(err) {
            var args, func;

            if (err) {
                return cb(err);
            }

            args = Array.prototype.slice.call(arguments);
            func = cbs.shift();

            if (func) {
                args.shift();
                args.push(next);
            } else {
                func = cb;
            }

            func.apply(null, args);
        })();
    }

    function openInBrowser(url) {
        childProcess.exec('open ' + url);
    }

    function cloneObj(obj) {
        function F() {}
        F.prototype = obj;
        return new F();
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

    function generagteKey() {
        cascade([function (cb) {
            }], function (err) {
        });
    }

    function isPortUsed(port, cb) {
        var server = net.createServer();
        server.listen(port);
        server.on('error', function (e) {
            if (e.code === 'EADDRINUSE') {
                cb(true);
            }
        });
        server.on('listening', function () {
            server.close();
            cb(false);
        });
    }


    function S(root, options) {
        var _server, _wsServer, wsClient, self = this;

        if (arguments.length === 1) {
            options = util.isObject(path) ? path : {
                root: root
            };
        }
        extendObj(defaults, options || {});

        this.options = cloneObj(defaults);
        this.router = new Router();
        this.route = null;
        this.pathname = '';
        this.start = function () {
            // 设置注入脚本端口号
            injectScript = injectScript.replace('{{port}}', self.options.port);

            isPortUsed(self.options.port, function (isUsed) {
                if (isUsed) {
                    console.log('port:', self.options.port, ' is used');
                    return;
                }
                _server = http.createServer(function (req, res) {
                    self.pathname = url.parse(req.url).pathname;
                    self.router.other(self.processStatic);
                    self.dispatch(req, res);

                });
                _server.on('listening', function () {
                    var date = formatTime(new Date());
                    console.log(date +
                            ' http server listen on: http://localhost:' +
                            self.options.port);
                    console.log(date +
                            ' websocket server listen on: ws://localhost:' +
                            self.options.port);
                    openInBrowser(self.options.host + ':' + self.options.port);
                });

                _server.listen(self.options.port);

                _wsServer = new WebSocketServer({
                    httpServer: _server,
                    autoAcceptConnections: false
                });

                _wsServer.on('request', function (request) {
                    var connection;
                    if (request.origin === 'disallow') {
                        return request.reject();
                    }

                    wsClient = request.accept('', request.origin);
                    console.log(formatTime(new Date()) + ' websocket连接成功');
                    wsClient.on('message', function (message) {
                        if (message.type === 'utf8') {
                            console.log('收到消息: ' + message.utf8Data);
                            wsClient.sendUTF(message.utf8Data);
                        }
                    });

                });
            });
        };

        this.close = function () {
            _server.close();
            _wsServer.close();
        };

        this.pushCss = function () {
            if (wsClient) {
                wsClient.sendUTF('css');
            }
        };

        this.pushAll = function () {
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
                console.log('代理请求错误');
                res.writeHead(500);
                res.end('代理请求错误');
            };

            request.onTimeout = function () {
                console.log('代理请求超时');
                res.writeHead(500);
                res.end('代理请求超时');
            };

            request.request(function (proxyRes) {
                proxyRes.pipe(res);
            }, postData);
        });
    };

    // 如果是目录则请求定义好的defaults即index.html文件
    S.prototype.processStatic = function (req, res, pathname) {
        var self = this, tmp;

        pathname = pathname || path.normalize(this.options.root +
                   this.pathname);

        if (this.route.rewrite) {
            tmp = pathname;
            pathname = pathname.replace(this.route.url, this.route.rewrite);
            pathname = path.normalize(pathname);
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
