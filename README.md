# 基于node的简单server + proxy + rewrite + livereload

简单前端静态服务器, 并能跨域请求, websocket及浏览器实时刷新，文件重定向

## 依赖

- event-stream
- websocket

## 使用
1. 把proxy.js放于静态文件开发根目录中， 运行:

```
node proxy.js [--port 9898] [--root ./]
```


然后可以访问http://localhost:8989使用

2. 通过node引用包

```
Qserver = require('./qserver');

var qserver = new Qserver(port, {
    documentRoot: './'
});

qserver.proxy('/api', 'https://target.server.com/api');
qserver.rewrite('/bower_components', '/../bower_components');
qserver.start();

qserver.pushCss(); // 刷新css
qserver.pushAll(); // 刷新页面
```
