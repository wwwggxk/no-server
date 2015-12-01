var http = require('http'),
    https = require('https'),
    fs = require('fs'),
    path = require('path'),
    util = require('util'),
    url = require('url'),
    querystring = require('querystring'),

    defaultIndex = 'index.html',
    defaultHost = 'http://localhost',
    defaultPort = 9797,

    proxyConfig = {
        pathname: '/proxy',
        action: 'https://www.tigerbrokers.com/api'
    },

    server;

function Request(options) {
    this.options = options;
}

Request.parseOptions = function (target) {
    // reg: ['匹配串', '代理地址', 'url参数可为undefined(有&)', '同前(无&)']
    var reg=/action=([^&]+)(&(.+))*/, match, parsedUrl = url.parse(target),
        options, prefix = proxyConfig.action, suffix = '', query;

    console.log('代理参数解析...');
    if (reg.test(parsedUrl.query)) {
        match = parsedUrl.query.match(reg);
        prefix = decodeURIComponent(match[1]);
        match[3] && (query = match[3]);
    } else {
        var index = parsedUrl.pathname.indexOf(proxyConfig.pathname);
        suffix = parsedUrl.pathname.slice(index + proxyConfig.pathname.length);
        query = parsedUrl.query;
    }

    options = url.parse(prefix + suffix + (query ? ('?' + query) : ''));

    console.log('解析代理参数完成');
    return options;
};

Request.prototype.onTimeout = function () {};

Request.prototype.onError = function () {};

Request.prototype.request = function (callback, postData) {
    var agent, request, start;

    agent = this.options.protocol === 'https:' ? https : http;

    console.log('代理请求中...');
    console.log(this.options);
    start = +new Date();
    request = agent.request(this.options, function (res) {
        console.log('代理请求成功 ' + res.statusCode + ' (' + (+new Date() - start)+'毫秒)');
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

function Router (path, handler) {
    this.routes = {};
}

Router.prototype.when = function (url, handler) {
    this.routes[url] = handler;
    return this;
};

Router.prototype.other = function (handler) {
    this.defaultHandler = handler;
    return this;
};

Router.prototype.add = function (url, handler) {
    this.routes[url] = handler;
    return this;
};

Router.prototype.remove = function (url) {
    delete this.routes[url];
    return this;
};

Router.prototype.getHandler = function (pathname) {
    if (pathname.length > 1) {
        for(var key in this.routes) {
            if (this.routes.hasOwnProperty(key) && !pathname.indexOf(key)) {
                return this.routes[key];
            }
        }
    }

    return this.defaultHandler;
};

var Server = (function () {
    var routes = [];

    return function (port, host) {
        var _server, self = this;
        this.router = new Router();
        this.start = function () {
            _server = http.createServer(function (req, res) {
                var handler = self.router.getHandler(url.parse(req.url).pathname);
                if (!handler) {
                    return static(req, res);
                }
                handler(req, res);

            }).listen(port || defaultPort);
        };
    };
})();

(server = new Server())
    .router
    .when('/api', processProxy)
    .when('/ipa', processApi)
    .other(static);

server.start();


// 代理处理
function processProxy(req, res) {
    var postData = '';
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

        options = Request.parseOptions(req.url);
        options.method = req.method;
        request = new Request(options);
        options.headers = {
            'Content-Type': req.headers['content-type'] || 'application/x-www-form-urlencoded',
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
}

// 处理请求, 如果是目录则请求定义好的defaults即index.html文件
function static(req, res, pathname) {
    pathname = pathname || path.normalize('.' + url.parse(req.url).pathname);

    fs.exists(pathname, function (exists) {
        if (!exists) {
            res.writeHead(404);
            return res.end('path not exists');
        }

        fs.access(pathname, fs.R_OK, function (err) {
            if (err) {
                res.writeHead(403);
                return res.end('permission denied');
            }

            fs.stat(pathname, function (err, stat) {
                if (err) {
                    res.writeHead(500);
                    return res.end('server error occurs');
                }

                if (stat.isDirectory()) {
                    return static(req, res, path.normalize(path.join(pathname, defaultIndex)));
                }

                res.writeHead('200');
                fs.createReadStream(pathname).pipe(res);
            });
        });

    });
}

// api
function processApi(req, res) {
    var data = {name: 'wq', age: 25};
    if (req.method.toLowerCase() === 'post') {
        res.setHeader('Content-Type', 'application/json');
        res.write(JSON.stringify(data));
        res.end();
    }
}
