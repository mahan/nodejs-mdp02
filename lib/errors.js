"use strict";

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

require('babel-polyfill');

var TimeoutError = function (_Error) {
    _inherits(TimeoutError, _Error);

    function TimeoutError(message) {
        _classCallCheck(this, TimeoutError);

        var _this = _possibleConstructorReturn(this, (TimeoutError.__proto__ || Object.getPrototypeOf(TimeoutError)).call(this, message));

        _this.name = 'TimeoutError';
        return _this;
    }

    return TimeoutError;
}(Error);

var ProtocolError = function (_Error2) {
    _inherits(ProtocolError, _Error2);

    function ProtocolError(message) {
        _classCallCheck(this, ProtocolError);

        var _this2 = _possibleConstructorReturn(this, (ProtocolError.__proto__ || Object.getPrototypeOf(ProtocolError)).call(this, message));

        _this2.name = 'ProtocolError';
        return _this2;
    }

    return ProtocolError;
}(Error);

module.exports.TimeoutError = TimeoutError;
module.exports.ProtocolError = ProtocolError;