# 基于node的前端开发调试服务器
**yes-server**: node-based debug server

## 功能(Features)

- 简单前端静态服务器(static file serve)

- 跨域请求(proxy)

- websocket及浏览器实时刷新(websocket & livereload)

- 文件重定向(path local rewrite)

- (__TODO__)api数据模拟(data mock)

## 安装使用(installation&usage)

**安装(installation)**

```
npm install yes-server
```

**默认值(options)**

```
{
    port: 9527,                 // port
    host: 'http://localhost',   // server domain
    root: './',                 // server serve path
    indexFile: 'index.html',    // server default index file
    browse: false               // whether open in browser automatically
}
```

**直接使用(global usage)**

```
yes-server [--port 9527] [--root .]
```


然后浏览器可以访问http://localhost:9527使用

**通过module使用(module usage)**

```
var YesServer = require('yes-server');

// YesServer.create(root, options)
var server = YesServer.create('.', {
    port: 9527
});

// api proxy(cross domain)
server.proxy('/api', 'https://target.server.com/api');

// path local rewrite
server.rewrite('/bower_components', '../bower_components');

server.start().then(function (serverInstance) {
    // serverInstance.close();
    // ...
});
server.pushCss(); // reload css
server.pushAll(); // reload page
```

## 依赖(Dependencies)
感谢(Great thanks)

- event-stream

- websocket

- q

- lodash
