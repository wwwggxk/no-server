var NoServer = require('../lib/no-server'),
    assert = require('assert'),
    request = require('request'),
    childProcess = require('child_process'),
    server;

describe('no-server', function () {
    it('should return "port is used" when specific port is used',
            function (done) {

        var server = NoServer.create('.').start();
        server.then(function (instance) {
            var serverB = NoServer.create('.').start();
            serverB.then(function(instanceB) {
            }, function (msg) {
                instance.close();
                assert.equal(msg, 'port:9527 is used');
                done();
            });
        });
    });

    it('should listen 9527 and access default index.html', function (done) {
        var server = NoServer.create('./resources/a').start();
        server.then(function (instance) {
            request('http://localhost:9527', function (err, res, body) {
                instance.close();
                assert.equal(res.statusCode, 200);
                assert.strictEqual(body, 'no-server-a\n');
                done();
            });
        });
    });

    it('should return 404 status code when requesting file that is not exist ',
            function (done) {

        var server = NoServer.create('./resources').start();
        server.then(function (instance) {
            request('http://localhost:9527/404.html', function (err, res, body) {
                instance.close();
                assert.equal(res.statusCode, 404);
                done();
            });
        });
    });

    it('should access file relative to the target path', function (done) {
        var server = NoServer.create('./resources/a', {
            port: 9528
        });
        server.rewrite('/', '../b');
        server.start().then(function (instance) {
            request('http://localhost:9528', function (err, res, body) {
                instance.close();
                assert.equal(body, 'no-server-b\n');
                done();
            });
        });
    });

    it('should access proxy url when path matches patterns', function (done) {
        var server = NoServer.create('./resources/a', {
            port: 9528
        });
        server.start().then(function (instanceA) {
            var serverB = NoServer.create('./resources/b', {
                port: 9529
            });

            serverB.proxy('/', 'http://localhost:9529/');
            serverB.start().then(function(instanceB) {
                request('http://localhost:9528/', function (err, res, body) {
                    instanceA.close();
                    instanceB.close();
                    assert.equal(body, 'no-server-a\n');
                    done();
                });
            });
        });
    });

    it('should get websocket data "css" when server invoke reloadCss function',
            function (done) {

        var server = NoServer.create('./resources');
        server.start().then(function (instance) {
            var WebSocketClient = require('websocket').client,
                client = new WebSocketClient();
            client.on('connect', function (connection) {
                connection.on('message', function (message) {
                    instance.close();
                    assert.equal(message.utf8Data, 'css');
                    done();
                });

                if (connection.connected) {
                    server.reloadCss();
                }
            });
            client.connect('ws://localhost:9527');
        });
    });

    it('should get websocket data "all" when server invoke reloadAll function',
            function (done) {

        var server = NoServer.create('./resources');
        server.start().then(function (instance) {
            var WebSocketClient = require('websocket').client,
                client = new WebSocketClient();
            client.on('connect', function (connection) {
                connection.on('message', function (message) {
                    instance.close();
                    assert.equal(message.utf8Data, 'all');
                    done();
                });

                if (connection.connected) {
                    server.reloadAll();
                }
            });
            client.connect('ws://localhost:9527');
        });
    });

    it('should access default path "." when used as global command no-server',
            function (done) {

        var binPath = path.join(__dirname, '../bin/shell'),
            result = childProcess.spawn(binPath, [], {cwd: __dirname}),
            flag = true;

        result.stdout.on('data', function (data) {
            console.log(data.toString());

            // server started successfully
            if (flag && data.toString().indexOf('http server started:') > -1) {
                flag = false;
                request('http://localhost:9527/', function (err, res, body) {
                    result.kill('SIGHUP');
                    assert.equal(body, 'no-server-default\n');
                    done();
                });
            }
        });
    });

    it('should access specific path when used as global command no-server',
            function (done) {

        var binPath = path.join(__dirname, '../bin/shell'),
            result = childProcess.spawn(binPath, ['--root', './resources/a'],
                     {cwd: __dirname}),
            flag = true;

        result.stdout.on('data', function (data) {
            console.log(data.toString());

            // server started successfully
            if (flag && data.toString().indexOf('http server started:') > -1) {
                flag = false;
                request('http://localhost:9527/', function (err, res, body) {
                    result.kill('SIGHUP');
                    assert.equal(body, 'no-server-a\n');
                    done();
                });
            }
        });
    });

    it('should access specific port when used as global command no-server',
            function (done) {

        var binPath = path.join(__dirname, '../bin/shell'),
            result = childProcess.spawn(binPath, ['--port', '9528'],
                     {cwd: __dirname}),
             flag = true;

        result.stdout.on('data', function (data) {
            console.log(data.toString());

            // server started successfully
            if (flag && data.toString().indexOf('http server started:') > -1) {
                flag = false;
                request('http://localhost:9528/', function (err, res, body) {
                    result.kill('SIGHUP');
                    assert.equal(body, 'no-server-default\n');
                    done();
                });
            }
        });
    });
});
