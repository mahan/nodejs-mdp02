"use strict";
/* global require */

require('babel-core/register');

const gulp = require('gulp'),
    _ = require('gulp-load-plugins')(),
    rmdir = require('rimraf');

function babelify(src, dest) {
    return gulp.src(src)
        .pipe(_.changed(dest))
        .pipe(_.sourcemaps.init())
        .pipe(_.babel({
            "presets": ["es2015"]
        }))
        .pipe(_.sourcemaps.write('.', {sourceRoot: '../src'}))
        .pipe(gulp.dest(dest));
}

gulp.task('build-lib', function () {
    return babelify('src/**/*.js', 'lib');
});

gulp.task('clean', function() {
    rmdir('lib', function (err) {
        err && console.error(err);
    });
});

gulp.task('test', () => {
    return gulp.src('tests/test.js', {read: false})
    // gulp-mocha needs filepaths so you can't have any plugins before it
        .pipe(_.mocha({reporter: 'spec'}));
});



gulp.task('default', ['clean', 'build-lib'], function() {
});