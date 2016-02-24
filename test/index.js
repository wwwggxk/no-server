var YesServer = require('../lib/yes-server'),
    assert = require('assert'),
    request = require('request'),
    server;

describe('serve server', function () {
    beforeEach(function () {
        server = YesServer.create('.');
    });
    it('test demo', function () {
        assert.ok(true, 'true');
        assert.ok(false, 'true1');
        assert(Array.isArray('a,b,c'.split(',')));
    });
    it('should listen default 9527', function (done) {
        request('http://localhost:9527', function (err, res, body) {
            console.log(res);
            assert.strictEqual(200, res.statusCode);
            done();
        });
    });
    it('request file that is not exist ', function (done) {
        request('http://localhost:9527/not-existed.html',
                function (err, res, body) {
            console.log(res);
            assert.strictEqual(200, res.statusCode);
            done();
        });
    });
    it('request files', function () {
    });
    it('request private file', function () {});
    it('default serve current path', function () {});
    it('proxy request', function () {});
    it('redirect path', function () {});
    it('live reload css', function () {});
    it('live refresh', function () {});
});
