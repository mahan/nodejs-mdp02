var rmdir = require('rimraf'),
    path = require('path');

rmdir(path.resolve(__dirname, 'lib', function (err) {
    err ? console.error(err) : console.log('Clean done!');
});