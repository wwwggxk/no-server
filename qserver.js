/*
 * lib: event-stream, websocket
 *
 * description: web静态服务器
 * 1. 支持静态web服务
 * 2. 支持跨域proxy
 * 3. 支持websocket及实时刷新css或者页面
 * 4. 支持重定向资源到本地文件
 *
 * author: wungqiang@gmail.com
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

    // 依赖
    eventStream = require('event-stream'),
    WebSocketServer = require('websocket').server,

    // 服务器配置
    defaultRoot = '.',
    defaultIndex = 'index.html',
    defaultHost = 'http://localhost',
    defaultPort = 8989,
    testApiPath = '/ipa',

    /*
     * 代理配置
     * 支持http(s)://www.domain.com/api?params=value
     * 或者http(s)://www.domain.com/api?action=proxy&params=value
     */
    proxyConfig = {
        '/v1': 'https://api1.server1.com/v1',
        '/v2': 'https://api2.server2.com/v2'
    },

    /*
     * 本地文件代理
     */
    rewriteConfig = {
        '/path': '/../parent'
    },

    injectScript, i;

// 解析参数
for (i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--port' && (i + 1) < process.argv.length) {
        defaultPort = process.argv[i + 1];
    }

    if (process.argv[i] === '--root' && (i + 1) < process.argv.length) {
        defaultRoot = process.argv[i + 1];
    }
}

/***************************************************************js代码注入片段*/
injectScript = '<script>' +
    'if ("WebSocket" in window) {' +
        'var socketServer="ws://localhost:" + ' + defaultPort +',' +
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

/*********************************************************************代理请求*/
function Request(options) {
    this.options = options;
}

Request.prototype.onTimeout = function () {};

Request.prototype.onError = function () {};

Request.parseOptions = function (target,route) {
    // reg: ['匹配串', '代理地址', 'url参数可为undefined(有&)', '同前(无&)']
    var reg=/action=([^&]+)(&(.+))*/,
        parsedUrl = url.parse(target),
        prefix = proxyConfig[route],
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
function Router (path, handler) {
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
        documentRoot: '.',
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
    };

    function openInBrowser(url) {
        childProcess.exec('open ' + url);
    }

    function extendObj(target, options) {
        var p;
        for (p in options) {
            target[p] = options[p];
        }
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


    function S(port, options) {
        var _server, _wsServer, wsClient, self = this;

        options = options || {};
        extendObj(defaults, options);

        this.options = cloneObj(defaults);
        this.router = new Router();
        this.route = null;
        this.pathname = '';
        this.start = function () {
            _server = http.createServer(function (req, res) {
                self.pathname = url.parse(req.url).pathname;
                self.router.other(self.processStatic);
                self.dispatch(req, res);

            });
            _server.listen(defaultPort);

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
        var date = formatTime(new Date());
        console.log(date + ' http server listen on: http://localhost:' +
                defaultPort);
        console.log(date + ' websocket server listen on: ws://localhost:' +
                defaultPort);
        openInBrowser(defaultHost + ':' + defaultPort);
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

            options = Request.parseOptions(req.url, self.route.url);
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

        pathname = pathname || path.normalize(this.options.documentRoot +
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

/*************************************************************************接口*/
function processApi(req, res) {
    var data = {name: 'wungqiang', skill: 'js'};
    if (req.method.toLowerCase() === 'post') {
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify(data));
        res.end();
    }
}

function init(port, options) {
    var pathname, server;

    server = new Server(port || defaultPort, options);
    return server;
}

if (require.main === module) {
    var server = init(defaultPort, {
        documentRoot: defaultRoot,
        indexFile: defaultIndex
    }), pathname;

    for(pathname in proxyConfig) {
        server.proxy(pathname, proxyConfig[pathname]);
    }
    for(pathname in rewriteConfig) {
        server.rewrite(pathname, rewriteConfig[pathname]);
    }
    server.router.when(testApiPath, processApi);

    server.start();
    return;
}

module.exports = {
    init: init
};
