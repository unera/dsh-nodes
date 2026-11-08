window.__ModuleLoader__.load({
  id: "@dr-co/dsh-nodes",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var React = __toESM(require("react"), 1);

// node_modules/qrcode-generator/dist/qrcode.mjs
var qrcode = function(typeNumber, errorCorrectionLevel) {
  const PAD0 = 236;
  const PAD1 = 17;
  let _typeNumber = typeNumber;
  const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
  let _modules = null;
  let _moduleCount = 0;
  let _dataCache = null;
  const _dataList = [];
  const _this = {};
  const makeImpl = function(test, maskPattern) {
    _moduleCount = _typeNumber * 4 + 17;
    _modules = function(moduleCount) {
      const modules = new Array(moduleCount);
      for (let row2 = 0; row2 < moduleCount; row2 += 1) {
        modules[row2] = new Array(moduleCount);
        for (let col = 0; col < moduleCount; col += 1) {
          modules[row2][col] = null;
        }
      }
      return modules;
    }(_moduleCount);
    setupPositionProbePattern(0, 0);
    setupPositionProbePattern(_moduleCount - 7, 0);
    setupPositionProbePattern(0, _moduleCount - 7);
    setupPositionAdjustPattern();
    setupTimingPattern();
    setupTypeInfo(test, maskPattern);
    if (_typeNumber >= 7) {
      setupTypeNumber(test);
    }
    if (_dataCache == null) {
      _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
    }
    mapData(_dataCache, maskPattern);
  };
  const setupPositionProbePattern = function(row2, col) {
    for (let r = -1; r <= 7; r += 1) {
      if (row2 + r <= -1 || _moduleCount <= row2 + r) continue;
      for (let c = -1; c <= 7; c += 1) {
        if (col + c <= -1 || _moduleCount <= col + c) continue;
        if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
          _modules[row2 + r][col + c] = true;
        } else {
          _modules[row2 + r][col + c] = false;
        }
      }
    }
  };
  const getBestMaskPattern = function() {
    let minLostPoint = 0;
    let pattern = 0;
    for (let i = 0; i < 8; i += 1) {
      makeImpl(true, i);
      const lostPoint = QRUtil.getLostPoint(_this);
      if (i == 0 || minLostPoint > lostPoint) {
        minLostPoint = lostPoint;
        pattern = i;
      }
    }
    return pattern;
  };
  const setupTimingPattern = function() {
    for (let r = 8; r < _moduleCount - 8; r += 1) {
      if (_modules[r][6] != null) {
        continue;
      }
      _modules[r][6] = r % 2 == 0;
    }
    for (let c = 8; c < _moduleCount - 8; c += 1) {
      if (_modules[6][c] != null) {
        continue;
      }
      _modules[6][c] = c % 2 == 0;
    }
  };
  const setupPositionAdjustPattern = function() {
    const pos = QRUtil.getPatternPosition(_typeNumber);
    for (let i = 0; i < pos.length; i += 1) {
      for (let j = 0; j < pos.length; j += 1) {
        const row2 = pos[i];
        const col = pos[j];
        if (_modules[row2][col] != null) {
          continue;
        }
        for (let r = -2; r <= 2; r += 1) {
          for (let c = -2; c <= 2; c += 1) {
            if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
              _modules[row2 + r][col + c] = true;
            } else {
              _modules[row2 + r][col + c] = false;
            }
          }
        }
      }
    }
  };
  const setupTypeNumber = function(test) {
    const bits = QRUtil.getBCHTypeNumber(_typeNumber);
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
    }
    for (let i = 0; i < 18; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
    }
  };
  const setupTypeInfo = function(test, maskPattern) {
    const data = _errorCorrectionLevel << 3 | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 6) {
        _modules[i][8] = mod;
      } else if (i < 8) {
        _modules[i + 1][8] = mod;
      } else {
        _modules[_moduleCount - 15 + i][8] = mod;
      }
    }
    for (let i = 0; i < 15; i += 1) {
      const mod = !test && (bits >> i & 1) == 1;
      if (i < 8) {
        _modules[8][_moduleCount - i - 1] = mod;
      } else if (i < 9) {
        _modules[8][15 - i - 1 + 1] = mod;
      } else {
        _modules[8][15 - i - 1] = mod;
      }
    }
    _modules[_moduleCount - 8][8] = !test;
  };
  const mapData = function(data, maskPattern) {
    let inc = -1;
    let row2 = _moduleCount - 1;
    let bitIndex = 7;
    let byteIndex = 0;
    const maskFunc = QRUtil.getMaskFunction(maskPattern);
    for (let col = _moduleCount - 1; col > 0; col -= 2) {
      if (col == 6) col -= 1;
      while (true) {
        for (let c = 0; c < 2; c += 1) {
          if (_modules[row2][col - c] == null) {
            let dark = false;
            if (byteIndex < data.length) {
              dark = (data[byteIndex] >>> bitIndex & 1) == 1;
            }
            const mask = maskFunc(row2, col - c);
            if (mask) {
              dark = !dark;
            }
            _modules[row2][col - c] = dark;
            bitIndex -= 1;
            if (bitIndex == -1) {
              byteIndex += 1;
              bitIndex = 7;
            }
          }
        }
        row2 += inc;
        if (row2 < 0 || _moduleCount <= row2) {
          row2 -= inc;
          inc = -inc;
          break;
        }
      }
    }
  };
  const createBytes = function(buffer, rsBlocks) {
    let offset = 0;
    let maxDcCount = 0;
    let maxEcCount = 0;
    const dcdata = new Array(rsBlocks.length);
    const ecdata = new Array(rsBlocks.length);
    for (let r = 0; r < rsBlocks.length; r += 1) {
      const dcCount = rsBlocks[r].dataCount;
      const ecCount = rsBlocks[r].totalCount - dcCount;
      maxDcCount = Math.max(maxDcCount, dcCount);
      maxEcCount = Math.max(maxEcCount, ecCount);
      dcdata[r] = new Array(dcCount);
      for (let i = 0; i < dcdata[r].length; i += 1) {
        dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
      }
      offset += dcCount;
      const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
      const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
      const modPoly = rawPoly.mod(rsPoly);
      ecdata[r] = new Array(rsPoly.getLength() - 1);
      for (let i = 0; i < ecdata[r].length; i += 1) {
        const modIndex = i + modPoly.getLength() - ecdata[r].length;
        ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
      }
    }
    let totalCodeCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalCodeCount += rsBlocks[i].totalCount;
    }
    const data = new Array(totalCodeCount);
    let index = 0;
    for (let i = 0; i < maxDcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < dcdata[r].length) {
          data[index] = dcdata[r][i];
          index += 1;
        }
      }
    }
    for (let i = 0; i < maxEcCount; i += 1) {
      for (let r = 0; r < rsBlocks.length; r += 1) {
        if (i < ecdata[r].length) {
          data[index] = ecdata[r][i];
          index += 1;
        }
      }
    }
    return data;
  };
  const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
    const buffer = qrBitBuffer();
    for (let i = 0; i < dataList.length; i += 1) {
      const data = dataList[i];
      buffer.put(data.getMode(), 4);
      buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
      data.write(buffer);
    }
    let totalDataCount = 0;
    for (let i = 0; i < rsBlocks.length; i += 1) {
      totalDataCount += rsBlocks[i].dataCount;
    }
    if (buffer.getLengthInBits() > totalDataCount * 8) {
      throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
    }
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
      buffer.put(0, 4);
    }
    while (buffer.getLengthInBits() % 8 != 0) {
      buffer.putBit(false);
    }
    while (true) {
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD0, 8);
      if (buffer.getLengthInBits() >= totalDataCount * 8) {
        break;
      }
      buffer.put(PAD1, 8);
    }
    return createBytes(buffer, rsBlocks);
  };
  _this.addData = function(data, mode) {
    mode = mode || "Byte";
    let newData = null;
    switch (mode) {
      case "Numeric":
        newData = qrNumber(data);
        break;
      case "Alphanumeric":
        newData = qrAlphaNum(data);
        break;
      case "Byte":
        newData = qr8BitByte(data);
        break;
      case "Kanji":
        newData = qrKanji(data);
        break;
      default:
        throw "mode:" + mode;
    }
    _dataList.push(newData);
    _dataCache = null;
  };
  _this.isDark = function(row2, col) {
    if (row2 < 0 || _moduleCount <= row2 || col < 0 || _moduleCount <= col) {
      throw row2 + "," + col;
    }
    return _modules[row2][col];
  };
  _this.getModuleCount = function() {
    return _moduleCount;
  };
  _this.make = function() {
    if (_typeNumber < 1) {
      let typeNumber2 = 1;
      for (; typeNumber2 < 40; typeNumber2++) {
        const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
        const buffer = qrBitBuffer();
        for (let i = 0; i < _dataList.length; i++) {
          const data = _dataList[i];
          buffer.put(data.getMode(), 4);
          buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
          data.write(buffer);
        }
        let totalDataCount = 0;
        for (let i = 0; i < rsBlocks.length; i++) {
          totalDataCount += rsBlocks[i].dataCount;
        }
        if (buffer.getLengthInBits() <= totalDataCount * 8) {
          break;
        }
      }
      _typeNumber = typeNumber2;
    }
    makeImpl(false, getBestMaskPattern());
  };
  _this.createTableTag = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    let qrHtml = "";
    qrHtml += '<table style="';
    qrHtml += " border-width: 0px; border-style: none;";
    qrHtml += " border-collapse: collapse;";
    qrHtml += " padding: 0px; margin: " + margin + "px;";
    qrHtml += '">';
    qrHtml += "<tbody>";
    for (let r = 0; r < _this.getModuleCount(); r += 1) {
      qrHtml += "<tr>";
      for (let c = 0; c < _this.getModuleCount(); c += 1) {
        qrHtml += '<td style="';
        qrHtml += " border-width: 0px; border-style: none;";
        qrHtml += " border-collapse: collapse;";
        qrHtml += " padding: 0px; margin: 0px;";
        qrHtml += " width: " + cellSize + "px;";
        qrHtml += " height: " + cellSize + "px;";
        qrHtml += " background-color: ";
        qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
        qrHtml += ";";
        qrHtml += '"/>';
      }
      qrHtml += "</tr>";
    }
    qrHtml += "</tbody>";
    qrHtml += "</table>";
    return qrHtml;
  };
  _this.createSvgTag = function(cellSize, margin, alt, title) {
    let opts = {};
    if (typeof arguments[0] == "object") {
      opts = arguments[0];
      cellSize = opts.cellSize;
      margin = opts.margin;
      alt = opts.alt;
      title = opts.title;
    }
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    alt = typeof alt === "string" ? { text: alt } : alt || {};
    alt.text = alt.text || null;
    alt.id = alt.text ? alt.id || "qrcode-description" : null;
    title = typeof title === "string" ? { text: title } : title || {};
    title.text = title.text || null;
    title.id = title.text ? title.id || "qrcode-title" : null;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let c, mc, r, mr, qrSvg = "", rect;
    rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
    qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
    qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
    qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
    qrSvg += ' preserveAspectRatio="xMinYMin meet"';
    qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
    qrSvg += ">";
    qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
    qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
    qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
    qrSvg += '<path d="';
    for (r = 0; r < _this.getModuleCount(); r += 1) {
      mr = r * cellSize + margin;
      for (c = 0; c < _this.getModuleCount(); c += 1) {
        if (_this.isDark(r, c)) {
          mc = c * cellSize + margin;
          qrSvg += "M" + mc + "," + mr + rect;
        }
      }
    }
    qrSvg += '" stroke="transparent" fill="black"/>';
    qrSvg += "</svg>";
    return qrSvg;
  };
  _this.createDataURL = function(cellSize, margin) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    return createDataURL(size, size, function(x, y) {
      if (min <= x && x < max && min <= y && y < max) {
        const c = Math.floor((x - min) / cellSize);
        const r = Math.floor((y - min) / cellSize);
        return _this.isDark(r, c) ? 0 : 1;
      } else {
        return 1;
      }
    });
  };
  _this.createImgTag = function(cellSize, margin, alt) {
    cellSize = cellSize || 2;
    margin = typeof margin == "undefined" ? cellSize * 4 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    let img = "";
    img += "<img";
    img += ' src="';
    img += _this.createDataURL(cellSize, margin);
    img += '"';
    img += ' width="';
    img += size;
    img += '"';
    img += ' height="';
    img += size;
    img += '"';
    if (alt) {
      img += ' alt="';
      img += escapeXml(alt);
      img += '"';
    }
    img += "/>";
    return img;
  };
  const escapeXml = function(s) {
    let escaped = "";
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charAt(i);
      switch (c) {
        case "<":
          escaped += "&lt;";
          break;
        case ">":
          escaped += "&gt;";
          break;
        case "&":
          escaped += "&amp;";
          break;
        case '"':
          escaped += "&quot;";
          break;
        default:
          escaped += c;
          break;
      }
    }
    return escaped;
  };
  const _createHalfASCII = function(margin) {
    const cellSize = 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r1, r2, p;
    const blocks = {
      "\u2588\u2588": "\u2588",
      "\u2588 ": "\u2580",
      " \u2588": "\u2584",
      "  ": " "
    };
    const blocksLastLineNoMargin = {
      "\u2588\u2588": "\u2580",
      "\u2588 ": "\u2580",
      " \u2588": " ",
      "  ": " "
    };
    let ascii = "";
    for (y = 0; y < size; y += 2) {
      r1 = Math.floor((y - min) / cellSize);
      r2 = Math.floor((y + 1 - min) / cellSize);
      for (x = 0; x < size; x += 1) {
        p = "\u2588";
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
          p = " ";
        }
        if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
          p += " ";
        } else {
          p += "\u2588";
        }
        ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
      }
      ascii += "\n";
    }
    if (size % 2 && margin > 0) {
      return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("\u2580");
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.createASCII = function(cellSize, margin) {
    cellSize = cellSize || 1;
    if (cellSize < 2) {
      return _createHalfASCII(margin);
    }
    cellSize -= 1;
    margin = typeof margin == "undefined" ? cellSize * 2 : margin;
    const size = _this.getModuleCount() * cellSize + margin * 2;
    const min = margin;
    const max = size - margin;
    let y, x, r, p;
    const white = Array(cellSize + 1).join("\u2588\u2588");
    const black = Array(cellSize + 1).join("  ");
    let ascii = "";
    let line = "";
    for (y = 0; y < size; y += 1) {
      r = Math.floor((y - min) / cellSize);
      line = "";
      for (x = 0; x < size; x += 1) {
        p = 1;
        if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
          p = 0;
        }
        line += p ? white : black;
      }
      for (r = 0; r < cellSize; r += 1) {
        ascii += line + "\n";
      }
    }
    return ascii.substring(0, ascii.length - 1);
  };
  _this.renderTo2dContext = function(context, cellSize) {
    cellSize = cellSize || 2;
    const length = _this.getModuleCount();
    for (let row2 = 0; row2 < length; row2++) {
      for (let col = 0; col < length; col++) {
        context.fillStyle = _this.isDark(row2, col) ? "black" : "white";
        context.fillRect(col * cellSize, row2 * cellSize, cellSize, cellSize);
      }
    }
  };
  return _this;
};
qrcode.stringToBytes = function(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    bytes.push(c & 255);
  }
  return bytes;
};
qrcode.createStringToBytes = function(unicodeData, numChars) {
  const unicodeMap = function() {
    const bin = base64DecodeInputStream(unicodeData);
    const read = function() {
      const b = bin.read();
      if (b == -1) throw "eof";
      return b;
    };
    let count = 0;
    const unicodeMap2 = {};
    while (true) {
      const b0 = bin.read();
      if (b0 == -1) break;
      const b1 = read();
      const b2 = read();
      const b3 = read();
      const k = String.fromCharCode(b0 << 8 | b1);
      const v = b2 << 8 | b3;
      unicodeMap2[k] = v;
      count += 1;
    }
    if (count != numChars) {
      throw count + " != " + numChars;
    }
    return unicodeMap2;
  }();
  const unknownChar = "?".charCodeAt(0);
  return function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      if (c < 128) {
        bytes.push(c);
      } else {
        const b = unicodeMap[s.charAt(i)];
        if (typeof b == "number") {
          if ((b & 255) == b) {
            bytes.push(b);
          } else {
            bytes.push(b >>> 8);
            bytes.push(b & 255);
          }
        } else {
          bytes.push(unknownChar);
        }
      }
    }
    return bytes;
  };
};
var QRMode = {
  MODE_NUMBER: 1 << 0,
  MODE_ALPHA_NUM: 1 << 1,
  MODE_8BIT_BYTE: 1 << 2,
  MODE_KANJI: 1 << 3
};
var QRErrorCorrectionLevel = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2
};
var QRMaskPattern = {
  PATTERN000: 0,
  PATTERN001: 1,
  PATTERN010: 2,
  PATTERN011: 3,
  PATTERN100: 4,
  PATTERN101: 5,
  PATTERN110: 6,
  PATTERN111: 7
};
var QRUtil = function() {
  const PATTERN_POSITION_TABLE = [
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
    [6, 30, 54],
    [6, 32, 58],
    [6, 34, 62],
    [6, 26, 46, 66],
    [6, 26, 48, 70],
    [6, 26, 50, 74],
    [6, 30, 54, 78],
    [6, 30, 56, 82],
    [6, 30, 58, 86],
    [6, 34, 62, 90],
    [6, 28, 50, 72, 94],
    [6, 26, 50, 74, 98],
    [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106],
    [6, 32, 58, 84, 110],
    [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118],
    [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126],
    [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134],
    [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142],
    [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150],
    [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158],
    [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166],
    [6, 30, 58, 86, 114, 142, 170]
  ];
  const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
  const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
  const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
  const _this = {};
  const getBCHDigit = function(data) {
    let digit = 0;
    while (data != 0) {
      digit += 1;
      data >>>= 1;
    }
    return digit;
  };
  _this.getBCHTypeInfo = function(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
      d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
    }
    return (data << 10 | d) ^ G15_MASK;
  };
  _this.getBCHTypeNumber = function(data) {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
      d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
    }
    return data << 12 | d;
  };
  _this.getPatternPosition = function(typeNumber) {
    return PATTERN_POSITION_TABLE[typeNumber - 1];
  };
  _this.getMaskFunction = function(maskPattern) {
    switch (maskPattern) {
      case QRMaskPattern.PATTERN000:
        return function(i, j) {
          return (i + j) % 2 == 0;
        };
      case QRMaskPattern.PATTERN001:
        return function(i, j) {
          return i % 2 == 0;
        };
      case QRMaskPattern.PATTERN010:
        return function(i, j) {
          return j % 3 == 0;
        };
      case QRMaskPattern.PATTERN011:
        return function(i, j) {
          return (i + j) % 3 == 0;
        };
      case QRMaskPattern.PATTERN100:
        return function(i, j) {
          return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
        };
      case QRMaskPattern.PATTERN101:
        return function(i, j) {
          return i * j % 2 + i * j % 3 == 0;
        };
      case QRMaskPattern.PATTERN110:
        return function(i, j) {
          return (i * j % 2 + i * j % 3) % 2 == 0;
        };
      case QRMaskPattern.PATTERN111:
        return function(i, j) {
          return (i * j % 3 + (i + j) % 2) % 2 == 0;
        };
      default:
        throw "bad maskPattern:" + maskPattern;
    }
  };
  _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
    let a = qrPolynomial([1], 0);
    for (let i = 0; i < errorCorrectLength; i += 1) {
      a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
    }
    return a;
  };
  _this.getLengthInBits = function(mode, type) {
    if (1 <= type && type < 10) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 10;
        case QRMode.MODE_ALPHA_NUM:
          return 9;
        case QRMode.MODE_8BIT_BYTE:
          return 8;
        case QRMode.MODE_KANJI:
          return 8;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 27) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 12;
        case QRMode.MODE_ALPHA_NUM:
          return 11;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 10;
        default:
          throw "mode:" + mode;
      }
    } else if (type < 41) {
      switch (mode) {
        case QRMode.MODE_NUMBER:
          return 14;
        case QRMode.MODE_ALPHA_NUM:
          return 13;
        case QRMode.MODE_8BIT_BYTE:
          return 16;
        case QRMode.MODE_KANJI:
          return 12;
        default:
          throw "mode:" + mode;
      }
    } else {
      throw "type:" + type;
    }
  };
  _this.getLostPoint = function(qrcode2) {
    const moduleCount = qrcode2.getModuleCount();
    let lostPoint = 0;
    for (let row2 = 0; row2 < moduleCount; row2 += 1) {
      for (let col = 0; col < moduleCount; col += 1) {
        let sameCount = 0;
        const dark = qrcode2.isDark(row2, col);
        for (let r = -1; r <= 1; r += 1) {
          if (row2 + r < 0 || moduleCount <= row2 + r) {
            continue;
          }
          for (let c = -1; c <= 1; c += 1) {
            if (col + c < 0 || moduleCount <= col + c) {
              continue;
            }
            if (r == 0 && c == 0) {
              continue;
            }
            if (dark == qrcode2.isDark(row2 + r, col + c)) {
              sameCount += 1;
            }
          }
        }
        if (sameCount > 5) {
          lostPoint += 3 + sameCount - 5;
        }
      }
    }
    ;
    for (let row2 = 0; row2 < moduleCount - 1; row2 += 1) {
      for (let col = 0; col < moduleCount - 1; col += 1) {
        let count = 0;
        if (qrcode2.isDark(row2, col)) count += 1;
        if (qrcode2.isDark(row2 + 1, col)) count += 1;
        if (qrcode2.isDark(row2, col + 1)) count += 1;
        if (qrcode2.isDark(row2 + 1, col + 1)) count += 1;
        if (count == 0 || count == 4) {
          lostPoint += 3;
        }
      }
    }
    for (let row2 = 0; row2 < moduleCount; row2 += 1) {
      for (let col = 0; col < moduleCount - 6; col += 1) {
        if (qrcode2.isDark(row2, col) && !qrcode2.isDark(row2, col + 1) && qrcode2.isDark(row2, col + 2) && qrcode2.isDark(row2, col + 3) && qrcode2.isDark(row2, col + 4) && !qrcode2.isDark(row2, col + 5) && qrcode2.isDark(row2, col + 6)) {
          lostPoint += 40;
        }
      }
    }
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row2 = 0; row2 < moduleCount - 6; row2 += 1) {
        if (qrcode2.isDark(row2, col) && !qrcode2.isDark(row2 + 1, col) && qrcode2.isDark(row2 + 2, col) && qrcode2.isDark(row2 + 3, col) && qrcode2.isDark(row2 + 4, col) && !qrcode2.isDark(row2 + 5, col) && qrcode2.isDark(row2 + 6, col)) {
          lostPoint += 40;
        }
      }
    }
    let darkCount = 0;
    for (let col = 0; col < moduleCount; col += 1) {
      for (let row2 = 0; row2 < moduleCount; row2 += 1) {
        if (qrcode2.isDark(row2, col)) {
          darkCount += 1;
        }
      }
    }
    const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
    lostPoint += ratio * 10;
    return lostPoint;
  };
  return _this;
}();
var QRMath = function() {
  const EXP_TABLE = new Array(256);
  const LOG_TABLE = new Array(256);
  for (let i = 0; i < 8; i += 1) {
    EXP_TABLE[i] = 1 << i;
  }
  for (let i = 8; i < 256; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
  }
  for (let i = 0; i < 255; i += 1) {
    LOG_TABLE[EXP_TABLE[i]] = i;
  }
  const _this = {};
  _this.glog = function(n) {
    if (n < 1) {
      throw "glog(" + n + ")";
    }
    return LOG_TABLE[n];
  };
  _this.gexp = function(n) {
    while (n < 0) {
      n += 255;
    }
    while (n >= 256) {
      n -= 255;
    }
    return EXP_TABLE[n];
  };
  return _this;
}();
var qrPolynomial = function(num, shift) {
  if (typeof num.length == "undefined") {
    throw num.length + "/" + shift;
  }
  const _num = function() {
    let offset = 0;
    while (offset < num.length && num[offset] == 0) {
      offset += 1;
    }
    const _num2 = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i += 1) {
      _num2[i] = num[i + offset];
    }
    return _num2;
  }();
  const _this = {};
  _this.getAt = function(index) {
    return _num[index];
  };
  _this.getLength = function() {
    return _num.length;
  };
  _this.multiply = function(e) {
    const num2 = new Array(_this.getLength() + e.getLength() - 1);
    for (let i = 0; i < _this.getLength(); i += 1) {
      for (let j = 0; j < e.getLength(); j += 1) {
        num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
      }
    }
    return qrPolynomial(num2, 0);
  };
  _this.mod = function(e) {
    if (_this.getLength() - e.getLength() < 0) {
      return _this;
    }
    const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
    const num2 = new Array(_this.getLength());
    for (let i = 0; i < _this.getLength(); i += 1) {
      num2[i] = _this.getAt(i);
    }
    for (let i = 0; i < e.getLength(); i += 1) {
      num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
    }
    return qrPolynomial(num2, 0).mod(e);
  };
  return _this;
};
var QRRSBlock = function() {
  const RS_BLOCK_TABLE = [
    // L
    // M
    // Q
    // H
    // 1
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
    // 2
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
    // 3
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
    // 4
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
    // 5
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
    // 6
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
    // 7
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
    // 8
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
    // 9
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
    // 10
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
    // 11
    [4, 101, 81],
    [1, 80, 50, 4, 81, 51],
    [4, 50, 22, 4, 51, 23],
    [3, 36, 12, 8, 37, 13],
    // 12
    [2, 116, 92, 2, 117, 93],
    [6, 58, 36, 2, 59, 37],
    [4, 46, 20, 6, 47, 21],
    [7, 42, 14, 4, 43, 15],
    // 13
    [4, 133, 107],
    [8, 59, 37, 1, 60, 38],
    [8, 44, 20, 4, 45, 21],
    [12, 33, 11, 4, 34, 12],
    // 14
    [3, 145, 115, 1, 146, 116],
    [4, 64, 40, 5, 65, 41],
    [11, 36, 16, 5, 37, 17],
    [11, 36, 12, 5, 37, 13],
    // 15
    [5, 109, 87, 1, 110, 88],
    [5, 65, 41, 5, 66, 42],
    [5, 54, 24, 7, 55, 25],
    [11, 36, 12, 7, 37, 13],
    // 16
    [5, 122, 98, 1, 123, 99],
    [7, 73, 45, 3, 74, 46],
    [15, 43, 19, 2, 44, 20],
    [3, 45, 15, 13, 46, 16],
    // 17
    [1, 135, 107, 5, 136, 108],
    [10, 74, 46, 1, 75, 47],
    [1, 50, 22, 15, 51, 23],
    [2, 42, 14, 17, 43, 15],
    // 18
    [5, 150, 120, 1, 151, 121],
    [9, 69, 43, 4, 70, 44],
    [17, 50, 22, 1, 51, 23],
    [2, 42, 14, 19, 43, 15],
    // 19
    [3, 141, 113, 4, 142, 114],
    [3, 70, 44, 11, 71, 45],
    [17, 47, 21, 4, 48, 22],
    [9, 39, 13, 16, 40, 14],
    // 20
    [3, 135, 107, 5, 136, 108],
    [3, 67, 41, 13, 68, 42],
    [15, 54, 24, 5, 55, 25],
    [15, 43, 15, 10, 44, 16],
    // 21
    [4, 144, 116, 4, 145, 117],
    [17, 68, 42],
    [17, 50, 22, 6, 51, 23],
    [19, 46, 16, 6, 47, 17],
    // 22
    [2, 139, 111, 7, 140, 112],
    [17, 74, 46],
    [7, 54, 24, 16, 55, 25],
    [34, 37, 13],
    // 23
    [4, 151, 121, 5, 152, 122],
    [4, 75, 47, 14, 76, 48],
    [11, 54, 24, 14, 55, 25],
    [16, 45, 15, 14, 46, 16],
    // 24
    [6, 147, 117, 4, 148, 118],
    [6, 73, 45, 14, 74, 46],
    [11, 54, 24, 16, 55, 25],
    [30, 46, 16, 2, 47, 17],
    // 25
    [8, 132, 106, 4, 133, 107],
    [8, 75, 47, 13, 76, 48],
    [7, 54, 24, 22, 55, 25],
    [22, 45, 15, 13, 46, 16],
    // 26
    [10, 142, 114, 2, 143, 115],
    [19, 74, 46, 4, 75, 47],
    [28, 50, 22, 6, 51, 23],
    [33, 46, 16, 4, 47, 17],
    // 27
    [8, 152, 122, 4, 153, 123],
    [22, 73, 45, 3, 74, 46],
    [8, 53, 23, 26, 54, 24],
    [12, 45, 15, 28, 46, 16],
    // 28
    [3, 147, 117, 10, 148, 118],
    [3, 73, 45, 23, 74, 46],
    [4, 54, 24, 31, 55, 25],
    [11, 45, 15, 31, 46, 16],
    // 29
    [7, 146, 116, 7, 147, 117],
    [21, 73, 45, 7, 74, 46],
    [1, 53, 23, 37, 54, 24],
    [19, 45, 15, 26, 46, 16],
    // 30
    [5, 145, 115, 10, 146, 116],
    [19, 75, 47, 10, 76, 48],
    [15, 54, 24, 25, 55, 25],
    [23, 45, 15, 25, 46, 16],
    // 31
    [13, 145, 115, 3, 146, 116],
    [2, 74, 46, 29, 75, 47],
    [42, 54, 24, 1, 55, 25],
    [23, 45, 15, 28, 46, 16],
    // 32
    [17, 145, 115],
    [10, 74, 46, 23, 75, 47],
    [10, 54, 24, 35, 55, 25],
    [19, 45, 15, 35, 46, 16],
    // 33
    [17, 145, 115, 1, 146, 116],
    [14, 74, 46, 21, 75, 47],
    [29, 54, 24, 19, 55, 25],
    [11, 45, 15, 46, 46, 16],
    // 34
    [13, 145, 115, 6, 146, 116],
    [14, 74, 46, 23, 75, 47],
    [44, 54, 24, 7, 55, 25],
    [59, 46, 16, 1, 47, 17],
    // 35
    [12, 151, 121, 7, 152, 122],
    [12, 75, 47, 26, 76, 48],
    [39, 54, 24, 14, 55, 25],
    [22, 45, 15, 41, 46, 16],
    // 36
    [6, 151, 121, 14, 152, 122],
    [6, 75, 47, 34, 76, 48],
    [46, 54, 24, 10, 55, 25],
    [2, 45, 15, 64, 46, 16],
    // 37
    [17, 152, 122, 4, 153, 123],
    [29, 74, 46, 14, 75, 47],
    [49, 54, 24, 10, 55, 25],
    [24, 45, 15, 46, 46, 16],
    // 38
    [4, 152, 122, 18, 153, 123],
    [13, 74, 46, 32, 75, 47],
    [48, 54, 24, 14, 55, 25],
    [42, 45, 15, 32, 46, 16],
    // 39
    [20, 147, 117, 4, 148, 118],
    [40, 75, 47, 7, 76, 48],
    [43, 54, 24, 22, 55, 25],
    [10, 45, 15, 67, 46, 16],
    // 40
    [19, 148, 118, 6, 149, 119],
    [18, 75, 47, 31, 76, 48],
    [34, 54, 24, 34, 55, 25],
    [20, 45, 15, 61, 46, 16]
  ];
  const qrRSBlock = function(totalCount, dataCount) {
    const _this2 = {};
    _this2.totalCount = totalCount;
    _this2.dataCount = dataCount;
    return _this2;
  };
  const _this = {};
  const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
    switch (errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H:
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default:
        return void 0;
    }
  };
  _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
    const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
    if (typeof rsBlock == "undefined") {
      throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
    }
    const length = rsBlock.length / 3;
    const list = [];
    for (let i = 0; i < length; i += 1) {
      const count = rsBlock[i * 3 + 0];
      const totalCount = rsBlock[i * 3 + 1];
      const dataCount = rsBlock[i * 3 + 2];
      for (let j = 0; j < count; j += 1) {
        list.push(qrRSBlock(totalCount, dataCount));
      }
    }
    return list;
  };
  return _this;
}();
var qrBitBuffer = function() {
  const _buffer = [];
  let _length = 0;
  const _this = {};
  _this.getBuffer = function() {
    return _buffer;
  };
  _this.getAt = function(index) {
    const bufIndex = Math.floor(index / 8);
    return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
  };
  _this.put = function(num, length) {
    for (let i = 0; i < length; i += 1) {
      _this.putBit((num >>> length - i - 1 & 1) == 1);
    }
  };
  _this.getLengthInBits = function() {
    return _length;
  };
  _this.putBit = function(bit) {
    const bufIndex = Math.floor(_length / 8);
    if (_buffer.length <= bufIndex) {
      _buffer.push(0);
    }
    if (bit) {
      _buffer[bufIndex] |= 128 >>> _length % 8;
    }
    _length += 1;
  };
  return _this;
};
var qrNumber = function(data) {
  const _mode = QRMode.MODE_NUMBER;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const data2 = _data;
    let i = 0;
    while (i + 2 < data2.length) {
      buffer.put(strToNum(data2.substring(i, i + 3)), 10);
      i += 3;
    }
    if (i < data2.length) {
      if (data2.length - i == 1) {
        buffer.put(strToNum(data2.substring(i, i + 1)), 4);
      } else if (data2.length - i == 2) {
        buffer.put(strToNum(data2.substring(i, i + 2)), 7);
      }
    }
  };
  const strToNum = function(s) {
    let num = 0;
    for (let i = 0; i < s.length; i += 1) {
      num = num * 10 + chatToNum(s.charAt(i));
    }
    return num;
  };
  const chatToNum = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    }
    throw "illegal char :" + c;
  };
  return _this;
};
var qrAlphaNum = function(data) {
  const _mode = QRMode.MODE_ALPHA_NUM;
  const _data = data;
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _data.length;
  };
  _this.write = function(buffer) {
    const s = _data;
    let i = 0;
    while (i + 1 < s.length) {
      buffer.put(
        getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
        11
      );
      i += 2;
    }
    if (i < s.length) {
      buffer.put(getCode(s.charAt(i)), 6);
    }
  };
  const getCode = function(c) {
    if ("0" <= c && c <= "9") {
      return c.charCodeAt(0) - "0".charCodeAt(0);
    } else if ("A" <= c && c <= "Z") {
      return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
    } else {
      switch (c) {
        case " ":
          return 36;
        case "$":
          return 37;
        case "%":
          return 38;
        case "*":
          return 39;
        case "+":
          return 40;
        case "-":
          return 41;
        case ".":
          return 42;
        case "/":
          return 43;
        case ":":
          return 44;
        default:
          throw "illegal char :" + c;
      }
    }
  };
  return _this;
};
var qr8BitByte = function(data) {
  const _mode = QRMode.MODE_8BIT_BYTE;
  const _data = data;
  const _bytes = qrcode.stringToBytes(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return _bytes.length;
  };
  _this.write = function(buffer) {
    for (let i = 0; i < _bytes.length; i += 1) {
      buffer.put(_bytes[i], 8);
    }
  };
  return _this;
};
var qrKanji = function(data) {
  const _mode = QRMode.MODE_KANJI;
  const _data = data;
  const stringToBytes2 = qrcode.stringToBytes;
  !function(c, code) {
    const test = stringToBytes2(c);
    if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
      throw "sjis not supported.";
    }
  }("\u53CB", 38726);
  const _bytes = stringToBytes2(data);
  const _this = {};
  _this.getMode = function() {
    return _mode;
  };
  _this.getLength = function(buffer) {
    return ~~(_bytes.length / 2);
  };
  _this.write = function(buffer) {
    const data2 = _bytes;
    let i = 0;
    while (i + 1 < data2.length) {
      let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
      if (33088 <= c && c <= 40956) {
        c -= 33088;
      } else if (57408 <= c && c <= 60351) {
        c -= 49472;
      } else {
        throw "illegal char at " + (i + 1) + "/" + c;
      }
      c = (c >>> 8 & 255) * 192 + (c & 255);
      buffer.put(c, 13);
      i += 2;
    }
    if (i < data2.length) {
      throw "illegal char at " + (i + 1);
    }
  };
  return _this;
};
var byteArrayOutputStream = function() {
  const _bytes = [];
  const _this = {};
  _this.writeByte = function(b) {
    _bytes.push(b & 255);
  };
  _this.writeShort = function(i) {
    _this.writeByte(i);
    _this.writeByte(i >>> 8);
  };
  _this.writeBytes = function(b, off, len) {
    off = off || 0;
    len = len || b.length;
    for (let i = 0; i < len; i += 1) {
      _this.writeByte(b[i + off]);
    }
  };
  _this.writeString = function(s) {
    for (let i = 0; i < s.length; i += 1) {
      _this.writeByte(s.charCodeAt(i));
    }
  };
  _this.toByteArray = function() {
    return _bytes;
  };
  _this.toString = function() {
    let s = "";
    s += "[";
    for (let i = 0; i < _bytes.length; i += 1) {
      if (i > 0) {
        s += ",";
      }
      s += _bytes[i];
    }
    s += "]";
    return s;
  };
  return _this;
};
var base64EncodeOutputStream = function() {
  let _buffer = 0;
  let _buflen = 0;
  let _length = 0;
  let _base64 = "";
  const _this = {};
  const writeEncoded = function(b) {
    _base64 += String.fromCharCode(encode(b & 63));
  };
  const encode = function(n) {
    if (n < 0) {
      throw "n:" + n;
    } else if (n < 26) {
      return 65 + n;
    } else if (n < 52) {
      return 97 + (n - 26);
    } else if (n < 62) {
      return 48 + (n - 52);
    } else if (n == 62) {
      return 43;
    } else if (n == 63) {
      return 47;
    } else {
      throw "n:" + n;
    }
  };
  _this.writeByte = function(n) {
    _buffer = _buffer << 8 | n & 255;
    _buflen += 8;
    _length += 1;
    while (_buflen >= 6) {
      writeEncoded(_buffer >>> _buflen - 6);
      _buflen -= 6;
    }
  };
  _this.flush = function() {
    if (_buflen > 0) {
      writeEncoded(_buffer << 6 - _buflen);
      _buffer = 0;
      _buflen = 0;
    }
    if (_length % 3 != 0) {
      const padlen = 3 - _length % 3;
      for (let i = 0; i < padlen; i += 1) {
        _base64 += "=";
      }
    }
  };
  _this.toString = function() {
    return _base64;
  };
  return _this;
};
var base64DecodeInputStream = function(str) {
  const _str = str;
  let _pos = 0;
  let _buffer = 0;
  let _buflen = 0;
  const _this = {};
  _this.read = function() {
    while (_buflen < 8) {
      if (_pos >= _str.length) {
        if (_buflen == 0) {
          return -1;
        }
        throw "unexpected end of file./" + _buflen;
      }
      const c = _str.charAt(_pos);
      _pos += 1;
      if (c == "=") {
        _buflen = 0;
        return -1;
      } else if (c.match(/^\s$/)) {
        continue;
      }
      _buffer = _buffer << 6 | decode(c.charCodeAt(0));
      _buflen += 6;
    }
    const n = _buffer >>> _buflen - 8 & 255;
    _buflen -= 8;
    return n;
  };
  const decode = function(c) {
    if (65 <= c && c <= 90) {
      return c - 65;
    } else if (97 <= c && c <= 122) {
      return c - 97 + 26;
    } else if (48 <= c && c <= 57) {
      return c - 48 + 52;
    } else if (c == 43) {
      return 62;
    } else if (c == 47) {
      return 63;
    } else {
      throw "c:" + c;
    }
  };
  return _this;
};
var gifImage = function(width, height) {
  const _width = width;
  const _height = height;
  const _data = new Array(width * height);
  const _this = {};
  _this.setPixel = function(x, y, pixel) {
    _data[y * _width + x] = pixel;
  };
  _this.write = function(out) {
    out.writeString("GIF87a");
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(128);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(0);
    out.writeByte(255);
    out.writeByte(255);
    out.writeByte(255);
    out.writeString(",");
    out.writeShort(0);
    out.writeShort(0);
    out.writeShort(_width);
    out.writeShort(_height);
    out.writeByte(0);
    const lzwMinCodeSize = 2;
    const raster = getLZWRaster(lzwMinCodeSize);
    out.writeByte(lzwMinCodeSize);
    let offset = 0;
    while (raster.length - offset > 255) {
      out.writeByte(255);
      out.writeBytes(raster, offset, 255);
      offset += 255;
    }
    out.writeByte(raster.length - offset);
    out.writeBytes(raster, offset, raster.length - offset);
    out.writeByte(0);
    out.writeString(";");
  };
  const bitOutputStream = function(out) {
    const _out = out;
    let _bitLength = 0;
    let _bitBuffer = 0;
    const _this2 = {};
    _this2.write = function(data, length) {
      if (data >>> length != 0) {
        throw "length over";
      }
      while (_bitLength + length >= 8) {
        _out.writeByte(255 & (data << _bitLength | _bitBuffer));
        length -= 8 - _bitLength;
        data >>>= 8 - _bitLength;
        _bitBuffer = 0;
        _bitLength = 0;
      }
      _bitBuffer = data << _bitLength | _bitBuffer;
      _bitLength = _bitLength + length;
    };
    _this2.flush = function() {
      if (_bitLength > 0) {
        _out.writeByte(_bitBuffer);
      }
    };
    return _this2;
  };
  const getLZWRaster = function(lzwMinCodeSize) {
    const clearCode = 1 << lzwMinCodeSize;
    const endCode = (1 << lzwMinCodeSize) + 1;
    let bitLength = lzwMinCodeSize + 1;
    const table = lzwTable();
    for (let i = 0; i < clearCode; i += 1) {
      table.add(String.fromCharCode(i));
    }
    table.add(String.fromCharCode(clearCode));
    table.add(String.fromCharCode(endCode));
    const byteOut = byteArrayOutputStream();
    const bitOut = bitOutputStream(byteOut);
    bitOut.write(clearCode, bitLength);
    let dataIndex = 0;
    let s = String.fromCharCode(_data[dataIndex]);
    dataIndex += 1;
    while (dataIndex < _data.length) {
      const c = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      if (table.contains(s + c)) {
        s = s + c;
      } else {
        bitOut.write(table.indexOf(s), bitLength);
        if (table.size() < 4095) {
          if (table.size() == 1 << bitLength) {
            bitLength += 1;
          }
          table.add(s + c);
        }
        s = c;
      }
    }
    bitOut.write(table.indexOf(s), bitLength);
    bitOut.write(endCode, bitLength);
    bitOut.flush();
    return byteOut.toByteArray();
  };
  const lzwTable = function() {
    const _map = {};
    let _size = 0;
    const _this2 = {};
    _this2.add = function(key) {
      if (_this2.contains(key)) {
        throw "dup key:" + key;
      }
      _map[key] = _size;
      _size += 1;
    };
    _this2.size = function() {
      return _size;
    };
    _this2.indexOf = function(key) {
      return _map[key];
    };
    _this2.contains = function(key) {
      return typeof _map[key] != "undefined";
    };
    return _this2;
  };
  return _this;
};
var createDataURL = function(width, height, getPixel) {
  const gif = gifImage(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gif.setPixel(x, y, getPixel(x, y));
    }
  }
  const b = byteArrayOutputStream();
  gif.write(b);
  const base64 = base64EncodeOutputStream();
  const bytes = b.toByteArray();
  for (let i = 0; i < bytes.length; i += 1) {
    base64.writeByte(bytes[i]);
  }
  base64.flush();
  return "data:image/gif;base64," + base64;
};
var qrcode_default = qrcode;
var stringToBytes = qrcode.stringToBytes;

// src/client/i18n.js
var NS = "dsh-nodes";
var en = {
  "pair.linkReady": "Link is ready",
  "pair.copy": "Copy to clipboard",
  "pair.copied": "copied",
  "pair.copyFailed": "could not copy: select the field manually",
  "pair.qr": "Scan with the phone",
  "tab.api": "API",
  "api.title": "APIs",
  "api.empty": "no APIs announced yet",
  "api.name": "name",
  "api.version": "version",
  "api.nodes": "nodes",
  "api.exporters": "Announced by: ",
  "settings.selfSession": "self \u2014 where files may be copied to",
  "settings.selfAlways": "the session working directory, always allowed",
  "settings.selfExtra": "additional host directories",
  "settings.selfNote": "The session working directory is always available: the model already writes there with its own tools. Additional directories are an explicit permission, because from there it can reach them with a local shell \u2014 under the DSH sandbox.",
  "unit.sec": "s",
  "confirm.separator": ", data from ",
  "confirm.binds": " and binds ",
  "err.nameTaken": 'Name "{name}" is already used by node {id} ({owner})',
  "err.aliasesTaken": "taken by other nodes: {list}",
  "confirm.revoke": "Revoke the token of node {id}? The current one stops working immediately.",
  "tab.connections": "Connections",
  "tab.audit": "Audit",
  "tab.settings": "Settings",
  "nodes.title": "Nodes",
  "nodes.none": "no nodes connected",
  "nodes.name": "name / aliases",
  "nodes.apis": "APIs",
  "nodes.access": "access",
  "nodes.actions": "actions",
  "nodes.noAliases": "no aliases",
  "nodes.new": "New node manually",
  "nodes.namePlaceholder": "name, e.g. nbw",
  "nodes.aliasesPlaceholder": "aliases, comma separated (any of them addresses the node)",
  "nodes.create": "create and issue a token",
  "nodes.edit": "edit name and aliases",
  "nodes.editTitle": "Edit",
  "nodes.revoke": "Revoke token",
  "nodes.delete": "Delete",
  "nodes.deleteTitle": "Delete",
  "nodes.save": "save",
  "nodes.cancel": "cancel",
  "nodes.created": "node created",
  "nodes.saved": "saved",
  "nodes.deleted": "deleted",
  "nodes.tokenReissued": "token reissued",
  "pair.title": "Connect a client",
  "pair.ttl": "link lifetime, seconds",
  "pair.make": "generate a link",
  "pair.note": "On the node: dshnc connect <link>. Nothing to confirm here \u2014 the code is single-use.",
  "pair.ready": "link ready",
  "pending.title": "Requests without a code",
  "pending.allow": "allow",
  "pending.deny": "deny",
  "pending.allowed": "allowed",
  "pending.denied": "denied",
  "audit.title": "Audit (recent events)",
  "audit.empty": "nothing yet",
  "audit.when": "when",
  "audit.what": "what",
  "audit.node": "node",
  "audit.mode": "mode",
  "audit.command": "command",
  "audit.exec": "ran",
  "audit.denied": "denied",
  "audit.approved": "allowed",
  "audit.rejected": "refused",
  "settings.title": "Settings",
  "settings.note": "Changed in the plugin config and applied after a restart. Here is what is in effect now.",
  "settings.self": "self \u2014 host directories files may be copied into",
  "settings.selfOff": "none (self is off)",
  "settings.wait": "how long the model waits for an answer",
  "settings.ttl": "how long a question lives in the node queue",
  "settings.alive": "node is considered alive after the last contact",
  "settings.ping": "socket ping",
  "settings.off": "off",
  "settings.failed": "could not read settings",
  "settings.selfNote": "Copying to the host works only for directories from self: it is a separate permission, because the model can then touch them with a local shell \u2014 already under the DSH sandbox.",
  "mode.ro": "ro \u2014 read only (read-only)",
  "mode.rw": "rw \u2014 write inside allowed directories (workspace-write)",
  "mode.fa": "FA \u2014 no sandbox: full access (danger-full-access)",
  "mode.baseHint": "base: {explain}. The command starts in this mode.",
  "mode.uptoHint": "upto: {explain}. Node ceiling: nothing goes wider even with approval.",
  "approver.web": "web: the human in DSH is asked \u2014 the question arrives in the GUI",
  "approver.local": "local: the human at this machine is asked \u2014 a dialog pops up on the node",
  "approver.none": "none: questions are off \u2014 a sandbox denial is final",
  "pill.online": "online",
  "pill.offline": "offline",
  "pill.never": "never seen",
  "pill.lastSeen": "last contact: {ago} ago",
  "pill.noContact": "no contact yet",
  "pill.working": "running {uptime}",
  "state.ready": "ready",
  "state.hung": "hanging",
  "state.unreachable": "unreachable",
  "summary.epoch": "epoch {epoch}, nodes {count}",
  "common.seconds": "{value} s",
  "common.waitForever": "{value} s (0 \u2014 until the call is cancelled)"
};
var ru = {
  "pair.linkReady": "\u0421\u0441\u044B\u043B\u043A\u0430 \u0433\u043E\u0442\u043E\u0432\u0430",
  "pair.copy": "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0432 \u0431\u0443\u0444\u0435\u0440",
  "pair.copied": "\u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E",
  "pair.copyFailed": "\u043D\u0435 \u0441\u043C\u043E\u0433 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C: \u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439 \u0432\u0440\u0443\u0447\u043D\u0443\u044E",
  "pair.qr": "\u041D\u0430\u0432\u0435\u0434\u0438 \u043A\u0430\u043C\u0435\u0440\u0443 \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430",
  "tab.api": "API",
  "api.title": "API",
  "api.empty": "\u043F\u043E\u043A\u0430 \u043D\u0438 \u043E\u0434\u0438\u043D \u0443\u0437\u0435\u043B \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043E\u0431\u044A\u044F\u0432\u0438\u043B",
  "api.name": "\u0438\u043C\u044F",
  "api.version": "\u0432\u0435\u0440\u0441\u0438\u044F",
  "api.nodes": "\u0443\u0437\u043B\u044B",
  "api.exporters": "\u041E\u0431\u044A\u044F\u0432\u043B\u044F\u044E\u0442: ",
  "settings.selfSession": "self \u2014 \u043A\u0443\u0434\u0430 \u043C\u043E\u0436\u043D\u043E \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0444\u0430\u0439\u043B\u044B",
  "settings.selfAlways": "\u0440\u0430\u0431\u043E\u0447\u0430\u044F \u0434\u0438\u0440\u0435\u043A\u0442\u043E\u0440\u0438\u044F \u0441\u0435\u0441\u0441\u0438\u0438, \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0430 \u0432\u0441\u0435\u0433\u0434\u0430",
  "settings.selfExtra": "\u0434\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0438 \u0445\u043E\u0441\u0442\u0430",
  "settings.selfNote": "\u0420\u0430\u0431\u043E\u0447\u0430\u044F \u0434\u0438\u0440\u0435\u043A\u0442\u043E\u0440\u0438\u044F \u0441\u0435\u0441\u0441\u0438\u0438 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0432\u0441\u0435\u0433\u0434\u0430: \u043C\u043E\u0434\u0435\u043B\u044C \u0438 \u0442\u0430\u043A \u043F\u0438\u0448\u0435\u0442 \u0442\u0443\u0434\u0430 \u0441\u0432\u043E\u0438\u043C\u0438 \u0438\u043D\u0441\u0442\u0440\u0443\u043C\u0435\u043D\u0442\u0430\u043C\u0438. \u0414\u043E\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C\u043D\u044B\u0435 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0438 \u2014 \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435, \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E \u0434\u0430\u043B\u044C\u0448\u0435 \u043E\u043D\u0430 \u043C\u043E\u0436\u0435\u0442 \u0434\u043E\u0441\u0442\u0430\u0442\u044C \u0438\u0445 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u043C shell, \u0443\u0436\u0435 \u043F\u043E\u0434 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u0435\u0439 DSH.",
  "unit.sec": "\u0441",
  "confirm.separator": ", \u0434\u0430\u043D\u043D\u044B\u0435 \u2014 \u0441 ",
  "confirm.binds": " \u0438 \u043F\u0440\u0438\u0432\u044F\u0437\u044B\u0432\u0430\u0435\u0442 ",
  "err.nameTaken": "\u0418\u043C\u044F \xAB{name}\xBB \u0443\u0436\u0435 \u0437\u0430\u043D\u044F\u0442\u043E \u0443\u0437\u043B\u043E\u043C {id} ({owner})",
  "err.aliasesTaken": "\u0437\u0430\u043D\u044F\u0442\u044B \u0434\u0440\u0443\u0433\u0438\u043C\u0438 \u0443\u0437\u043B\u0430\u043C\u0438: {list}",
  "confirm.revoke": "\u041E\u0442\u043E\u0437\u0432\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D \u0443\u0437\u043B\u0430 {id}? \u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043D\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0441\u0440\u0430\u0437\u0443.",
  "tab.connections": "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u044F",
  "tab.audit": "\u0410\u0443\u0434\u0438\u0442",
  "tab.settings": "\u041E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
  "nodes.title": "\u0423\u0437\u043B\u044B",
  "nodes.none": "\u0443\u0437\u043B\u043E\u0432 \u043D\u0435\u0442",
  "nodes.name": "\u0438\u043C\u044F / \u0430\u043B\u0438\u0430\u0441\u044B",
  "nodes.apis": "API",
  "nodes.access": "\u0434\u043E\u0441\u0442\u0443\u043F",
  "nodes.actions": "\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F",
  "nodes.noAliases": "\u0431\u0435\u0437 \u0430\u043B\u0438\u0430\u0441\u043E\u0432",
  "nodes.new": "\u041D\u043E\u0432\u044B\u0439 \u0443\u0437\u0435\u043B \u0432\u0440\u0443\u0447\u043D\u0443\u044E",
  "nodes.namePlaceholder": "\u0438\u043C\u044F, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440 nbw",
  "nodes.aliasesPlaceholder": "\u0430\u043B\u0438\u0430\u0441\u044B \u0447\u0435\u0440\u0435\u0437 \u0437\u0430\u043F\u044F\u0442\u0443\u044E (\u043F\u043E \u043B\u044E\u0431\u043E\u043C\u0443 \u0438\u0437 \u043D\u0438\u0445 \u0443\u0437\u0435\u043B \u043C\u043E\u0436\u043D\u043E \u043F\u043E\u0437\u0432\u0430\u0442\u044C)",
  "nodes.create": "\u0441\u043E\u0437\u0434\u0430\u0442\u044C \u0438 \u0432\u044B\u0434\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D",
  "nodes.edit": "\u043F\u0440\u0430\u0432\u043A\u0430 \u0438\u043C\u0435\u043D\u0438 \u0438 \u0430\u043B\u0438\u0430\u0441\u043E\u0432",
  "nodes.editTitle": "\u0420\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u043E\u0432\u0430\u0442\u044C",
  "nodes.revoke": "\u041E\u0442\u043E\u0437\u0432\u0430\u0442\u044C \u0442\u043E\u043A\u0435\u043D",
  "nodes.delete": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
  "nodes.deleteTitle": "\u0423\u0434\u0430\u043B\u0438\u0442\u044C",
  "nodes.save": "\u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C",
  "nodes.cancel": "\u043E\u0442\u043C\u0435\u043D\u0430",
  "nodes.created": "\u0443\u0437\u0435\u043B \u0441\u043E\u0437\u0434\u0430\u043D",
  "nodes.saved": "\u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E",
  "nodes.deleted": "\u0443\u0434\u0430\u043B\u0451\u043D",
  "nodes.tokenReissued": "\u0442\u043E\u043A\u0435\u043D \u043F\u0435\u0440\u0435\u0432\u044B\u043F\u0443\u0449\u0435\u043D",
  "pair.title": "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u043A\u043B\u0438\u0435\u043D\u0442\u0430",
  "pair.ttl": "\u0441\u0435\u043A\u0443\u043D\u0434\u044B \u0436\u0438\u0437\u043D\u0438 \u0441\u0441\u044B\u043B\u043A\u0438",
  "pair.make": "\u0441\u0433\u0435\u043D\u0435\u0440\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443",
  "pair.note": "\u041D\u0430 \u0443\u0437\u043B\u0435: dshnc connect <\u0441\u0441\u044B\u043B\u043A\u0430>. \u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0442\u044C \u0437\u0434\u0435\u0441\u044C \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0443\u0436\u043D\u043E, \u043A\u043E\u0434 \u043E\u0434\u043D\u043E\u0440\u0430\u0437\u043E\u0432\u044B\u0439.",
  "pair.ready": "\u0441\u0441\u044B\u043B\u043A\u0430 \u0433\u043E\u0442\u043E\u0432\u0430",
  "pending.title": "\u0417\u0430\u044F\u0432\u043A\u0438 \u0431\u0435\u0437 \u043A\u043E\u0434\u0430",
  "pending.allow": "\u0434\u043E\u043F\u0443\u0441\u0442\u0438\u0442\u044C",
  "pending.deny": "\u043E\u0442\u043A\u043B\u043E\u043D\u0438\u0442\u044C",
  "pending.allowed": "\u0434\u043E\u043F\u0443\u0449\u0435\u043D",
  "pending.denied": "\u043E\u0442\u043A\u043B\u043E\u043D\u0451\u043D",
  "audit.title": "\u0410\u0443\u0434\u0438\u0442 (\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u044F)",
  "audit.empty": "\u043F\u043E\u043A\u0430 \u043F\u0443\u0441\u0442\u043E",
  "audit.when": "\u043A\u043E\u0433\u0434\u0430",
  "audit.what": "\u0447\u0442\u043E",
  "audit.node": "\u0443\u0437\u0435\u043B",
  "audit.mode": "\u0440\u0435\u0436\u0438\u043C",
  "audit.command": "\u043A\u043E\u043C\u0430\u043D\u0434\u0430",
  "audit.exec": "\u0438\u0441\u043F\u043E\u043B\u043D\u0435\u043D\u043E",
  "audit.denied": "\u043E\u0442\u043A\u0430\u0437",
  "audit.approved": "\u0440\u0430\u0437\u0440\u0435\u0448\u0438\u043B",
  "audit.rejected": "\u0437\u0430\u043F\u0440\u0435\u0442\u0438\u043B",
  "settings.title": "\u041E\u0431\u0449\u0438\u0435 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
  "settings.note": "\u041C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u0432 \u043A\u043E\u043D\u0444\u0438\u0433\u0435 \u043F\u043B\u0430\u0433\u0438\u043D\u0430 \u0438 \u043F\u0440\u0438\u043C\u0435\u043D\u044F\u044E\u0442\u0441\u044F \u043F\u043E\u0441\u043B\u0435 \u043F\u0435\u0440\u0435\u0437\u0430\u043F\u0443\u0441\u043A\u0430. \u0417\u0434\u0435\u0441\u044C \u043F\u043E\u043A\u0430\u0437\u0430\u043D\u043E, \u0447\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 \u0441\u0435\u0439\u0447\u0430\u0441.",
  "settings.self": "self \u2014 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0438 \u0445\u043E\u0441\u0442\u0430, \u043A\u0443\u0434\u0430 \u043C\u043E\u0436\u043D\u043E \u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441 \u0443\u0437\u043B\u043E\u0432",
  "settings.selfOff": "\u043D\u0435\u0442 (self \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D)",
  "settings.wait": "\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u043C\u043E\u0434\u0435\u043B\u044C \u0436\u0434\u0451\u0442 \u043E\u0442\u0432\u0435\u0442\u0430 \u043D\u0430 \u0432\u043E\u043F\u0440\u043E\u0441",
  "settings.ttl": "\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0432\u043E\u043F\u0440\u043E\u0441 \u0436\u0438\u0432\u0451\u0442 \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438 \u0443\u0437\u043B\u0430",
  "settings.alive": "\u0443\u0437\u0435\u043B \u0441\u0447\u0438\u0442\u0430\u0435\u0442\u0441\u044F \u0436\u0438\u0432\u044B\u043C \u043F\u043E\u0441\u043B\u0435 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0439 \u0441\u0432\u044F\u0437\u0438",
  "settings.ping": "\u043F\u0438\u043D\u0433 \u043F\u043E \u0441\u043E\u043A\u0435\u0442\u0443",
  "settings.off": "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D",
  "settings.failed": "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438",
  "settings.selfNote": "\u041A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u043D\u0430 \u0445\u043E\u0441\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0442\u043E\u043B\u044C\u043A\u043E \u0434\u043B\u044F \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u0432 \u0438\u0437 self: \u044D\u0442\u043E \u043E\u0442\u0434\u0435\u043B\u044C\u043D\u043E\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0438\u0435, \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E \u0434\u0430\u043B\u044C\u0448\u0435 \u043C\u043E\u0434\u0435\u043B\u044C \u043C\u043E\u0436\u0435\u0442 \u0442\u0440\u043E\u0433\u0430\u0442\u044C \u0438\u0445 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u043C shell \u2014 \u0443\u0436\u0435 \u043F\u043E\u0434 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u0435\u0439 DSH.",
  "mode.ro": "ro \u2014 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u0435\u043D\u0438\u0435 (read-only)",
  "mode.rw": "rw \u2014 \u0437\u0430\u043F\u0438\u0441\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0432\u043D\u0443\u0442\u0440\u0438 \u0440\u0430\u0437\u0440\u0435\u0448\u0451\u043D\u043D\u044B\u0445 \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u043E\u0432 (workspace-write)",
  "mode.fa": "FA \u2014 \u0431\u0435\u0437 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u044B: \u043F\u043E\u043B\u043D\u044B\u0439 \u0434\u043E\u0441\u0442\u0443\u043F (danger-full-access)",
  "mode.baseHint": "base: {explain}. \u0412 \u044D\u0442\u043E\u043C \u0440\u0435\u0436\u0438\u043C\u0435 \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u0441\u0442\u0430\u0440\u0442\u0443\u0435\u0442.",
  "mode.uptoHint": "upto: {explain}. \u041F\u043E\u0442\u043E\u043B\u043E\u043A \u0443\u0437\u043B\u0430: \u0432\u044B\u0448\u0435 \u043D\u0435 \u043F\u043E\u0434\u043D\u0438\u043C\u0435\u0442\u0441\u044F \u0434\u0430\u0436\u0435 \u0441 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0435\u043C.",
  "approver.web": "web: \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0432 DSH \u2014 \u0432\u043E\u043F\u0440\u043E\u0441 \u043F\u0440\u0438\u0445\u043E\u0434\u0438\u0442 \u0432 GUI",
  "approver.local": "local: \u0441\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u0442 \u0447\u0435\u043B\u043E\u0432\u0435\u043A \u0437\u0430 \u044D\u0442\u043E\u0439 \u043C\u0430\u0448\u0438\u043D\u043E\u0439 \u2014 \u0432\u043E\u043F\u0440\u043E\u0441 \u0432\u0441\u043F\u043B\u044B\u0432\u0430\u0435\u0442 \u043D\u0430 \u0443\u0437\u043B\u0435 (zenity \u0438 \u043F\u043E\u0434\u043E\u0431\u043D\u043E\u0435)",
  "approver.none": "none: \u0432\u043E\u043F\u0440\u043E\u0441\u044B \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u044B \u2014 \u043E\u0442\u043A\u0430\u0437 \u043F\u0435\u0441\u043E\u0447\u043D\u0438\u0446\u044B \u043E\u043A\u043E\u043D\u0447\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439",
  "pill.online": "online",
  "pill.offline": "offline",
  "pill.never": "\u043D\u0438\u043A\u043E\u0433\u0434\u0430",
  "pill.lastSeen": "\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0441\u0432\u044F\u0437\u044C: {ago} \u043D\u0430\u0437\u0430\u0434",
  "pill.noContact": "\u0441\u0432\u044F\u0437\u0438 \u0435\u0449\u0451 \u043D\u0435 \u0431\u044B\u043B\u043E",
  "pill.working": "\u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 {uptime}",
  "state.ready": "\u0433\u043E\u0442\u043E\u0432\u0430",
  "state.hung": "\u0432\u0438\u0441\u0438\u0442",
  "state.unreachable": "\u043D\u0435\u0442 \u0441\u0432\u044F\u0437\u0438",
  "summary.epoch": "epoch {epoch}, \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 {count}",
  "common.seconds": "{value} \u0441",
  "common.waitForever": "{value} \u0441 (0 \u2014 \u0434\u043E \u043E\u0442\u043C\u0435\u043D\u044B \u0432\u044B\u0437\u043E\u0432\u0430)"
};
var zh = {
  "pair.linkReady": "\u94FE\u63A5\u5DF2\u751F\u6210",
  "pair.copy": "\u590D\u5236\u5230\u526A\u8D34\u677F",
  "pair.copied": "\u5DF2\u590D\u5236",
  "pair.copyFailed": "\u590D\u5236\u5931\u8D25",
  "pair.qr": "\u7528\u624B\u673A\u626B\u63CF",
  "tab.api": "API",
  "api.title": "API",
  "api.empty": "\u8FD8\u6CA1\u6709\u8282\u70B9\u58F0\u660E API",
  "api.name": "\u540D\u79F0",
  "api.version": "\u7248\u672C",
  "api.nodes": "\u8282\u70B9",
  "api.exporters": "\u7531\u4EE5\u4E0B\u8282\u70B9\u63D0\u4F9B\uFF1A",
  "settings.selfSession": "self \u2014 \u53EF\u590D\u5236\u5230\u4F55\u5904",
  "settings.selfAlways": "\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u59CB\u7EC8\u5141\u8BB8",
  "settings.selfExtra": "\u989D\u5916\u7684\u5BBF\u4E3B\u76EE\u5F55",
  "settings.selfNote": "\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\u59CB\u7EC8\u53EF\u7528\uFF1A\u6A21\u578B\u672C\u6765\u5C31\u7528\u5B83\u81EA\u5DF1\u7684\u5DE5\u5177\u5199\u5165\u3002\u989D\u5916\u76EE\u5F55\u662F\u5355\u72EC\u7684\u6388\u6743\uFF0C\u56E0\u4E3A\u4E4B\u540E\u5B83\u53EF\u4EE5\u7528\u672C\u5730 shell \u8BBF\u95EE\uFF08\u5728 DSH \u6C99\u7BB1\u4E0B\uFF09\u3002",
  "unit.sec": "\u79D2",
  "confirm.separator": "\uFF0C\u6570\u636E\u6765\u81EA ",
  "confirm.binds": " \u5E76\u7ED1\u5B9A ",
  "err.nameTaken": "\u540D\u79F0\u201C{name}\u201D\u5DF2\u88AB\u8282\u70B9 {id}\uFF08{owner}\uFF09\u5360\u7528",
  "err.aliasesTaken": "\u5DF2\u88AB\u5176\u4ED6\u8282\u70B9\u5360\u7528\uFF1A{list}",
  "confirm.revoke": "\u64A4\u9500\u8282\u70B9 {id} \u7684\u4EE4\u724C\uFF1F\u5F53\u524D\u4EE4\u724C\u5C06\u7ACB\u5373\u5931\u6548\u3002",
  "tab.connections": "\u8FDE\u63A5",
  "tab.audit": "\u5BA1\u8BA1",
  "tab.settings": "\u8BBE\u7F6E",
  "nodes.title": "\u8282\u70B9",
  "nodes.none": "\u8FD8\u6CA1\u6709\u8282\u70B9",
  "nodes.name": "\u540D\u79F0 / \u522B\u540D",
  "nodes.apis": "API",
  "nodes.access": "\u6743\u9650",
  "nodes.actions": "\u64CD\u4F5C",
  "nodes.noAliases": "\u6CA1\u6709\u522B\u540D",
  "nodes.new": "\u624B\u52A8\u65B0\u5EFA\u8282\u70B9",
  "nodes.namePlaceholder": "\u540D\u79F0\uFF0C\u4F8B\u5982 nbw",
  "nodes.aliasesPlaceholder": "\u522B\u540D\uFF0C\u9017\u53F7\u5206\u9694",
  "nodes.create": "\u521B\u5EFA\u5E76\u53D1\u653E\u4EE4\u724C",
  "nodes.edit": "\u4FEE\u6539\u540D\u79F0\u548C\u522B\u540D",
  "nodes.editTitle": "\u7F16\u8F91",
  "nodes.revoke": "\u64A4\u9500\u4EE4\u724C",
  "nodes.delete": "\u5220\u9664",
  "nodes.deleteTitle": "\u5220\u9664",
  "nodes.save": "\u4FDD\u5B58",
  "nodes.cancel": "\u53D6\u6D88",
  "nodes.created": "\u8282\u70B9\u5DF2\u521B\u5EFA",
  "nodes.saved": "\u5DF2\u4FDD\u5B58",
  "nodes.deleted": "\u5DF2\u5220\u9664",
  "nodes.tokenReissued": "\u4EE4\u724C\u5DF2\u91CD\u65B0\u53D1\u653E",
  "pair.title": "\u8FDE\u63A5\u5BA2\u6237\u7AEF",
  "pair.ttl": "\u94FE\u63A5\u6709\u6548\u671F\uFF0C\u79D2",
  "pair.make": "\u751F\u6210\u94FE\u63A5",
  "pair.note": "\u5728\u8282\u70B9\u4E0A\u6267\u884C\uFF1Adshnc connect <\u94FE\u63A5>\u3002\u8FD9\u91CC\u65E0\u9700\u786E\u8BA4\uFF0C\u4EE3\u7801\u53EA\u80FD\u4F7F\u7528\u4E00\u6B21\u3002",
  "pair.ready": "\u94FE\u63A5\u5DF2\u751F\u6210",
  "pending.title": "\u672A\u51ED\u7801\u7684\u7533\u8BF7",
  "pending.allow": "\u5141\u8BB8",
  "pending.deny": "\u62D2\u7EDD",
  "pending.allowed": "\u5DF2\u5141\u8BB8",
  "pending.denied": "\u5DF2\u62D2\u7EDD",
  "audit.title": "\u5BA1\u8BA1\uFF08\u6700\u8FD1\u4E8B\u4EF6\uFF09",
  "audit.empty": "\u8FD8\u6CA1\u6709\u8BB0\u5F55",
  "audit.when": "\u65F6\u95F4",
  "audit.what": "\u4E8B\u4EF6",
  "audit.node": "\u8282\u70B9",
  "audit.mode": "\u6A21\u5F0F",
  "audit.command": "\u547D\u4EE4",
  "audit.exec": "\u5DF2\u6267\u884C",
  "audit.denied": "\u88AB\u62D2",
  "audit.approved": "\u5DF2\u5141\u8BB8",
  "audit.rejected": "\u5DF2\u62D2\u7EDD",
  "settings.title": "\u8BBE\u7F6E",
  "settings.note": "\u5728\u63D2\u4EF6\u914D\u7F6E\u4E2D\u4FEE\u6539\uFF0C\u91CD\u542F\u540E\u751F\u6548\u3002\u8FD9\u91CC\u663E\u793A\u5F53\u524D\u751F\u6548\u7684\u503C\u3002",
  "settings.self": "self \u2014 \u53EF\u4ECE\u8282\u70B9\u590D\u5236\u5230\u7684\u5BBF\u4E3B\u76EE\u5F55",
  "settings.selfOff": "\u65E0\uFF08self \u5DF2\u5173\u95ED\uFF09",
  "settings.wait": "\u6A21\u578B\u7B49\u5F85\u56DE\u7B54\u7684\u65F6\u957F",
  "settings.ttl": "\u95EE\u9898\u5728\u8282\u70B9\u961F\u5217\u4E2D\u7684\u5B58\u6D3B\u65F6\u95F4",
  "settings.alive": "\u6700\u540E\u4E00\u6B21\u8054\u7CFB\u540E\u89C6\u4E3A\u5728\u7EBF\u7684\u65F6\u957F",
  "settings.ping": "\u5957\u63A5\u5B57 ping",
  "settings.off": "\u5DF2\u5173\u95ED",
  "settings.failed": "\u65E0\u6CD5\u8BFB\u53D6\u8BBE\u7F6E",
  "settings.selfNote": "\u53EA\u6709\u5728 self \u4E2D\u5217\u51FA\u7684\u76EE\u5F55\u624D\u80FD\u63A5\u6536\u590D\u5236\uFF1A\u8FD9\u662F\u5355\u72EC\u7684\u6388\u6743\uFF0C\u56E0\u4E3A\u4E4B\u540E\u6A21\u578B\u53EF\u4EE5\u7528\u672C\u5730 shell \u64CD\u4F5C\u5B83\u4EEC\uFF08\u5DF2\u5728 DSH \u6C99\u7BB1\u4E0B\uFF09\u3002",
  "mode.ro": "ro \u2014 \u53EA\u8BFB",
  "mode.rw": "rw \u2014 \u53EA\u5141\u8BB8\u5728\u6388\u6743\u76EE\u5F55\u5185\u5199\u5165",
  "mode.fa": "FA \u2014 \u65E0\u6C99\u7BB1\uFF1A\u5B8C\u5168\u8BBF\u95EE",
  "mode.baseHint": "base: {explain}\u3002\u547D\u4EE4\u4EE5\u6B64\u6A21\u5F0F\u542F\u52A8\u3002",
  "mode.uptoHint": "upto: {explain}\u3002\u8282\u70B9\u4E0A\u9650\uFF1A\u5373\u4F7F\u786E\u8BA4\u4E5F\u4E0D\u4F1A\u66F4\u5BBD\u3002",
  "approver.web": "web\uFF1A\u8BE2\u95EE DSH \u4E2D\u7684\u4EBA\uFF0C\u95EE\u9898\u51FA\u73B0\u5728\u56FE\u5F62\u754C\u9762",
  "approver.local": "local\uFF1A\u8BE2\u95EE\u672C\u673A\u7684\u4EBA\uFF0C\u8282\u70B9\u4E0A\u5F39\u51FA\u5BF9\u8BDD\u6846",
  "approver.none": "none\uFF1A\u4E0D\u63D0\u95EE\uFF0C\u6C99\u7BB1\u62D2\u7EDD\u5373\u4E3A\u6700\u7EC8\u7ED3\u679C",
  "pill.online": "online",
  "pill.offline": "offline",
  "pill.never": "\u4ECE\u672A",
  "pill.lastSeen": "\u6700\u540E\u8054\u7CFB\uFF1A{ago} \u524D",
  "pill.noContact": "\u8FD8\u6CA1\u6709\u8054\u7CFB\u8FC7",
  "pill.working": "\u5DF2\u8FD0\u884C {uptime}",
  "state.ready": "\u5C31\u7EEA",
  "state.hung": "\u65E0\u54CD\u5E94",
  "state.unreachable": "\u65E0\u8FDE\u63A5",
  "summary.epoch": "epoch {epoch}\uFF0C\u8BBE\u5907 {count}",
  "common.seconds": "{value} \u79D2",
  "common.waitForever": "{value} \u79D2\uFF080 \u2014 \u76F4\u5230\u8C03\u7528\u88AB\u53D6\u6D88\uFF09"
};

// src/client/index.js
var Base = React.Component ?? Object;
var BASE = "/api/dsh-nodes";
async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    ...options
  });
  const text = await response.text();
  const type = response.headers.get("content-type") ?? "";
  let parsed = null;
  if (text && type.includes("json")) {
    parsed = JSON.parse(text);
  } else if (text) {
    throw new Error(`${response.status}: ${text.replace(/\s+/g, " ").slice(0, 120)}`);
  }
  if (!response.ok) throw new Error(parsed?.message ?? `${response.status}`);
  return parsed;
}
var op = (payload) => request("/op", { method: "POST", body: JSON.stringify(payload) });
var STYLE_ID = "dsh-nodes-styles";
var CSS = `
.dshn { display: flex; flex-direction: column; gap: 16px; font-size: 14px; }
.dshn h3 { font-size: 13px; letter-spacing: .04em; text-transform: uppercase; opacity: .6; margin: 0 0 8px; font-weight: 600; }
.dshn table { width: 100%; border-collapse: collapse; }
.dshn th, .dshn td { text-align: left; padding: 7px 8px; border-bottom: 1px solid rgba(128,128,128,.25); vertical-align: top; }
.dshn th { font-size: 12px; opacity: .6; font-weight: 600; }
.dshn code { font: 12px ui-monospace, SFMono-Regular, monospace; }
.dshn button { font: inherit; padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; cursor: pointer; }
.dshn button:hover { border-color: currentColor; }
.dshn button.primary { border-color: #3b82f6; color: #3b82f6; }
.dshn button.danger { color: #ef4444; }
.dshn button.glyph { padding: 4px 6px; display: inline-flex; align-items: center; justify-content: center; border-color: transparent; }
.dshn button.glyph:hover { background: rgba(128,128,128,.15); border-color: rgba(128,128,128,.4); }
.dshn input, .dshn textarea { font: inherit; padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(128,128,128,.4); background: transparent; color: inherit; box-sizing: border-box; width: 100%; }
.dshn .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dshn .muted { opacity: .6; }
.dshn .pair { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; margin-top: 10px; }
.dshn .pair .pane { flex: 1 1 240px; min-width: 200px; }
.dshn .pair .qr { display: flex; justify-content: center; }
.dshn .badge { font-size: 11px; padding: 1px 6px; border-radius: 6px; border: 1px solid rgba(128,128,128,.35); cursor: help; }
/* \u0440\u0435\u0436\u0438\u043C\u044B \u0446\u0432\u0435\u0442\u043E\u043C: ro \u2014 \u043A\u0440\u0430\u0441\u043D\u044B\u0439, rw \u2014 \u0441\u0438\u043D\u0438\u0439, full \u2014 \u0437\u0435\u043B\u0451\u043D\u044B\u0439 */
.dshn .badge.ro { color: #ef4444; border-color: #ef444488; }
.dshn .badge.rw { color: #3b82f6; border-color: #3b82f688; }
.dshn .badge.fa { color: #16a34a; border-color: #16a34a88; }
.dshn .pill { font-size: 11px; padding: 1px 7px; border-radius: 999px; border: 1px solid rgba(128,128,128,.4); margin-left: 6px; white-space: nowrap; }
.dshn .on { color: #16a34a; border-color: #16a34a88; }
/* \u0441\u0432\u044F\u0437\u044C \u0431\u044B\u043B\u0430 \u0431\u043E\u043B\u044C\u0448\u0435 \u043C\u0438\u043D\u0443\u0442\u044B \u043D\u0430\u0437\u0430\u0434 \u2014 \u0443\u0436\u0435 \u043D\u0435 \u0437\u0435\u043B\u0451\u043D\u044B\u0439 */
.dshn .stale { color: #3b82f6; border-color: #3b82f688; }
/* \u0431\u043E\u043B\u044C\u0448\u0435 \u043F\u044F\u0442\u0438 \u043C\u0438\u043D\u0443\u0442 \u2014 \u0441\u0435\u0440\u044B\u0439 */
.dshn .cold { color: #6b7280; border-color: #6b728088; }
/* offline \u2014 \u043A\u0440\u0430\u0441\u043D\u044B\u0439 */
.dshn .off { color: #ef4444; border-color: #ef444488; }
.dshn .tabs { display: flex; gap: 6px; margin: 10px 0; border-bottom: 1px solid rgba(128,128,128,.25); }
.dshn .tab { font: inherit; font-size: 13px; padding: 6px 12px; background: transparent; border: none; border-bottom: 2px solid transparent; color: inherit; opacity: .65; cursor: pointer; }
.dshn .tab.active { opacity: 1; border-bottom-color: currentColor; }
.dshn .msg { min-height: 18px; font-size: 13px; }
.dshn .msg.bad { color: #ef4444; }
.dshn .msg.good { color: #16a34a; }
.dshn .secret { font: 12px ui-monospace, monospace; word-break: break-all; padding: 8px; border: 1px dashed #f59e0b; border-radius: 8px; margin-top: 8px; }
.dshn .empty { opacity: .6; padding: 8px 0; }
.dshn .aliases { font-size: 12px; opacity: .6; margin-top: 2px; }
.dshn .chips { display: flex; flex-wrap: wrap; gap: 4px; max-width: 240px; }
.dshn .chip { font: 12px ui-monospace, monospace; padding: 1px 6px; border-radius: 4px; background: rgba(128,128,128,.15); white-space: nowrap; }
.dshn .editor { border: 1px solid rgba(128,128,128,.35); border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.dshn .editor label { font-size: 12px; opacity: .7; display: block; margin-bottom: 4px; }
.dshn .actions { display: flex; gap: 2px; justify-content: flex-end; }
.dshn .tipbox { position: fixed; z-index: 40; padding: 3px 8px; border-radius: 5px; font-size: 12px; white-space: nowrap; background: rgba(28,28,30,.97); color: #fff; border: 1px solid rgba(255,255,255,.18); pointer-events: none; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
`;
function mountStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return () => {
  };
  const element = document.createElement("style");
  element.id = STYLE_ID;
  element.textContent = CSS;
  document.head.appendChild(element);
  return () => element.remove();
}
function splitAliases(value) {
  return String(value ?? "").split(/[,\n;]+/).map((part) => part.trim()).filter(Boolean);
}
function uptimeText(seconds) {
  if (seconds == null) return null;
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
function renderQr(text) {
  const qr = qrcode_default(0, "M");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const cells = [];
  for (let row2 = 0; row2 < size; row2 += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.isDark(row2, col)) cells.push((0, import_react.createElement)("rect", { key: `${row2}-${col}`, x: col, y: row2, width: 1, height: 1 }));
    }
  }
  return (0, import_react.createElement)("svg", {
    key: "svg",
    viewBox: `0 0 ${size} ${size}`,
    width: 180,
    height: 180,
    shapeRendering: "crispEdges",
    style: { background: "#fff", borderRadius: 8 }
  }, cells);
}
function row(what, value) {
  return (0, import_react.createElement)("tr", { key: what }, [
    (0, import_react.createElement)("td", { key: "w", className: "muted" }, what),
    (0, import_react.createElement)("td", { key: "v" }, (0, import_react.createElement)("code", null, String(value)))
  ]);
}
var MODE_SHORT = {
  "read-only": "ro",
  "workspace-write": "rw",
  "danger-full-access": "FA",
  ro: "ro",
  rw: "rw",
  full: "FA"
};
var MODE_KEY = {
  "read-only": "mode.ro",
  "workspace-write": "mode.rw",
  "danger-full-access": "mode.fa",
  ro: "mode.ro",
  rw: "mode.rw",
  full: "mode.fa"
};
function modeBadge(label, mode, kind) {
  if (!mode) return null;
  const text = MODE_SHORT[mode] ?? mode;
  const tone = { ro: "ro", rw: "rw", full: "fa", "read-only": "ro", "workspace-write": "rw", "danger-full-access": "fa" }[mode] ?? null;
  const explain = t(MODE_KEY[mode] ?? String(mode));
  const hint = kind === "base" ? t("mode.baseHint", { explain }) : t("mode.uptoHint", { explain });
  return (0, import_react.createElement)("span", { key: label, className: `badge ${tone ?? ""}`, title: hint }, `${label}:${text}`);
}
function approverBadge(approver) {
  const view = {
    server: { glyph: "\u{1F310}", key: "approver.web" },
    local: { glyph: "\u{1F4BB}", key: "approver.local" },
    none: { glyph: "\u2205", key: "approver.none" }
  }[approver];
  if (!view) return null;
  return (0, import_react.createElement)("span", { key: "approver", className: "badge", title: t(view.key) }, view.glyph);
}
function pillState(node) {
  if (!pillOnline(node)) return "off";
  const age = node.lastSeen ? Date.now() - node.lastSeen : Infinity;
  if (age < 6e4) return "on";
  if (age < 3e5) return "stale";
  return "cold";
}
function pillOnline(node) {
  if (typeof node.attached === "boolean") return node.attached;
  return Boolean(node.online);
}
function ago(ms) {
  if (!ms) return t("pill.never");
  const s = Math.max(0, Math.round((Date.now() - ms) / 1e3));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
function Glyph({ kind }) {
  const paths = {
    edit: "M4 20h4l10-10-4-4L4 16v4zm12.7-12.7 1.6-1.6a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-1.6 1.6 3 3z",
    unplug: "M8.5 7.5 6 10a4.5 4.5 0 0 0 0 6.4l1.6 1.6M15.5 16.5 18 14a4.5 4.5 0 0 0 0-6.4l-1.6-1.6M9 15l6-6",
    trash: "M9 3h6l1 2h4v2H4V5h4l1-2zM6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8z"
  };
  return (0, import_react.createElement)("svg", {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: kind === "unplug" ? "none" : "currentColor",
    stroke: kind === "unplug" ? "currentColor" : "none",
    strokeWidth: kind === "unplug" ? 1.8 : 0,
    strokeLinecap: "round",
    "aria-hidden": "true"
  }, (0, import_react.createElement)("path", { d: paths[kind] }));
}
function GlyphButton({ kind, title, onClick, disabled, className }) {
  return (0, import_react.createElement)("button", {
    className: `glyph ${className ?? ""}`,
    // position: fixed у подсказки — потому что панель настроек обрезает всё,
    // что выходит за её границы
    "data-tip": title,
    "aria-label": title,
    disabled: Boolean(disabled),
    onClick
  }, (0, import_react.createElement)(Glyph, { kind }));
}
function NodeEditor({ node, busy, error, onSave, onCancel }) {
  const outside = () => node.aliases.filter((alias) => alias.toLowerCase() !== node.name.toLowerCase());
  const [name2, setName] = (0, import_react.useState)(node.name);
  const [aliases, setAliases] = (0, import_react.useState)(outside().join(", "));
  (0, import_react.useEffect)(() => {
    setName(node.name);
    setAliases(node.aliases.filter((alias) => alias.toLowerCase() !== node.name.toLowerCase()).join(", "));
  }, [node.id, node.name, node.aliases.join(",")]);
  const submit = () => onSave(node.id, { name: name2.trim(), aliases: splitAliases(aliases) });
  return (0, import_react.createElement)("div", { className: "editor" }, [
    (0, import_react.createElement)("div", { key: "title", className: "row" }, [
      (0, import_react.createElement)("strong", { key: "t" }, `\u0423\u0437\u0435\u043B ${node.id}`),
      (0, import_react.createElement)("span", { key: "n", className: "muted" }, t("nodes.edit"))
    ]),
    (0, import_react.createElement)("div", { key: "name" }, [
      (0, import_react.createElement)("label", { key: "l" }, t("nodes.title")),
      (0, import_react.createElement)("input", {
        key: "i",
        value: name2,
        onChange: (event) => setName(event.target.value),
        onKeyDown: (event) => {
          if (event.key === "Enter") submit();
        }
      })
    ]),
    (0, import_react.createElement)("div", { key: "aliases" }, [
      (0, import_react.createElement)("label", { key: "l" }, t("nodes.aliasesPlaceholder")),
      (0, import_react.createElement)("textarea", {
        key: "t",
        rows: 2,
        value: aliases,
        onChange: (event) => setAliases(event.target.value)
      })
    ]),
    error ? (0, import_react.createElement)("div", { key: "error", className: "msg bad", style: { minHeight: 0 } }, error) : null,
    (0, import_react.createElement)("div", { key: "actions", className: "row" }, [
      (0, import_react.createElement)("button", { key: "save", className: "primary", disabled: busy || !name2.trim(), onClick: submit }, t("nodes.save")),
      (0, import_react.createElement)("button", { key: "cancel", disabled: busy, onClick: onCancel }, t("nodes.cancel"))
    ])
  ]);
}
function NodeRow({ node, busy, onEdit, onRevoke, onDelete }) {
  return (0, import_react.createElement)("tr", null, [
    (0, import_react.createElement)("td", { key: "id" }, (0, import_react.createElement)("code", null, node.id)),
    (0, import_react.createElement)("td", { key: "name" }, [
      (0, import_react.createElement)("div", { key: "n" }, [
        (0, import_react.createElement)("span", { key: "name" }, node.name),
        (0, import_react.createElement)("span", {
          key: "pill",
          // цвет плашки говорит о свежести связи: зелёный — только что, синий —
          // больше минуты, серый — больше пяти, красный — связи нет вовсе
          className: `pill ${pillState(node)}`,
          title: node.lastSeen ? t("pill.lastSeen", { ago: ago(node.lastSeen) }) : t("pill.noContact")
        }, pillOnline(node) ? t("pill.online") : t("pill.offline"))
      ]),
      (0, import_react.createElement)("div", { key: "a", className: "aliases" }, node.aliases.filter((alias) => alias !== node.name).join(", ") || t("nodes.noAliases")),
      // аптайм отдельной строкой под именем: видно, работает ли узел с ночи или
      // только что перезапустился
      node.online && uptimeText(node.uptimeSeconds) ? (0, import_react.createElement)("div", { key: "u", className: "muted", style: { fontSize: 12, marginTop: 2 } }, t("pill.working", { uptime: uptimeText(node.uptimeSeconds) })) : null
    ]),
    (0, import_react.createElement)("td", { key: "apis" }, (0, import_react.createElement)(
      "div",
      { className: "chips" },
      node.apis.length ? node.apis.map((api) => (0, import_react.createElement)("span", { key: api.id, className: "chip" }, `${api.name}${api.version ? `@${api.version}` : ""}`)) : (0, import_react.createElement)("span", { className: "muted" }, "\u2014")
    )),
    (0, import_react.createElement)("td", { key: "access" }, [
      (0, import_react.createElement)("div", { key: "modes", style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } }, [
        modeBadge("base", node.base, "base"),
        modeBadge("upto", node.access, "upto"),
        approverBadge(node.approver)
      ]),
      node.clientVersion ? (0, import_react.createElement)("div", { key: "v", className: "muted", style: { fontSize: 12 } }, node.clientVersion) : null
    ]),
    (0, import_react.createElement)("td", { key: "actions" }, (0, import_react.createElement)("div", { className: "actions" }, [
      (0, import_react.createElement)(GlyphButton, { key: "e", kind: "edit", title: t("nodes.editTitle"), disabled: busy, onClick: () => onEdit(node.id) }),
      (0, import_react.createElement)(GlyphButton, { key: "t", kind: "unplug", title: t("nodes.revoke"), disabled: busy, onClick: () => onRevoke(node.id) }),
      (0, import_react.createElement)(GlyphButton, { key: "d", kind: "trash", title: t("nodes.delete"), disabled: busy, className: "danger", onClick: () => onDelete(node.id) })
    ]))
  ]);
}
function NodesPanel() {
  const [nodes, setNodes] = (0, import_react.useState)([]);
  const [pending, setPending] = (0, import_react.useState)([]);
  const [epoch, setEpoch] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [message, setMessage] = (0, import_react.useState)({ text: "", kind: "" });
  const [secret, setSecret] = (0, import_react.useState)(null);
  const [link, setLink] = (0, import_react.useState)(null);
  const [ttl, setTtl] = (0, import_react.useState)(600);
  const [newName, setNewName] = (0, import_react.useState)("");
  const [audit, setAudit] = (0, import_react.useState)([]);
  const [settings, setSettings] = (0, import_react.useState)(null);
  const [tab, setTab] = (0, import_react.useState)("connections");
  const [catalog, setCatalog] = (0, import_react.useState)([]);
  const [expanded, setExpanded] = (0, import_react.useState)(null);
  const only = (name2) => ({ display: tab === name2 ? "block" : "none" });
  const tabButton = (id, label) => (0, import_react.createElement)("button", {
    key: id,
    className: tab === id ? "tab active" : "tab",
    disabled: busy,
    onClick: () => setTab(id)
  }, label);
  const [editing, setEditing] = (0, import_react.useState)(null);
  const [tip, setTip] = (0, import_react.useState)(null);
  const [editorError, setEditorError] = (0, import_react.useState)("");
  const say = (text, kind = "") => setMessage({ text, kind });
  async function load() {
    try {
      const [list, waiting, events] = await Promise.all([
        request("/nodes"),
        request("/pending"),
        request("/audit?limit=50").catch(() => ({ audit: [] }))
      ]);
      setNodes(list.nodes ?? []);
      setEpoch(list.epoch ?? null);
      setPending(waiting.pending ?? []);
      setAudit(events.audit ?? []);
      try {
        setSettings(await request("/settings"));
      } catch {
        setSettings(null);
      }
      try {
        const list2 = await request("/catalog");
        setCatalog(list2.apis ?? []);
      } catch {
        setCatalog([]);
      }
    } catch (error) {
      say(error.message, "bad");
    }
  }
  (0, import_react.useEffect)(() => {
    load();
    const timer = setInterval(load, 5e3);
    return () => clearInterval(timer);
  }, []);
  async function run(payload, okText) {
    setBusy(true);
    try {
      const result = await op(payload);
      say(okText, "good");
      if (result?.token) setSecret(result.token);
      if (result?.rejected?.length) say(t("err.aliasesTaken", { list: result.rejected.join(", ") }), "bad");
      await load();
      return { ok: true };
    } catch (error) {
      say(error.message, "bad");
      return { ok: false, error: error.message };
    } finally {
      setBusy(false);
    }
  }
  const showTipFor = (event) => {
    const target = event.target?.closest?.("button[data-tip]");
    if (!target) return;
    const rect = target.getBoundingClientRect();
    setTip({ text: target.getAttribute("data-tip"), x: rect.left + rect.width / 2, y: rect.bottom + 6 });
  };
  const hideTipIfLeft = (event) => {
    const target = event.target?.closest?.("button[data-tip]");
    if (!target) return;
    if (event.relatedTarget && target.contains(event.relatedTarget)) return;
    setTip(null);
  };
  return (0, import_react.createElement)("div", {
    className: "dshn",
    onMouseOver: showTipFor,
    onMouseOut: hideTipIfLeft,
    onFocusIn: (event) => {
      const target = event.target?.closest?.("button[data-tip]");
      if (!target) return;
      const rect = target.getBoundingClientRect();
      setTip({ text: target.getAttribute("data-tip"), x: rect.left + rect.width / 2, y: rect.bottom + 6 });
    },
    onFocusOut: () => setTip(null),
    onScroll: () => setTip(null)
  }, [
    (0, import_react.createElement)(
      "div",
      { key: "msg", className: `msg ${message.kind}` },
      message.text || (epoch != null ? t("summary.epoch", { epoch, count: nodes.length }) : "")
    ),
    // Панель разбита на вкладки: подключения — то, с чего начинают, аудит —
    // то, куда смотрят редко, настройки — то, что меняют один раз.
    (0, import_react.createElement)("div", { key: "tabs", className: "tabs" }, [
      tabButton("connections", t("tab.connections")),
      tabButton("api", t("tab.api")),
      tabButton("audit", t("tab.audit")),
      tabButton("settings", t("tab.settings"))
    ]),
    secret ? (0, import_react.createElement)("div", { key: "secret", className: "secret" }, `\u0442\u043E\u043A\u0435\u043D (\u043F\u043E\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437): ${secret}`) : null,
    (0, import_react.createElement)("section", { key: "pair", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, t("pair.title")),
      (0, import_react.createElement)("div", { key: "r", className: "row" }, [
        (0, import_react.createElement)("input", { key: "ttl", type: "number", value: ttl, style: { width: 90 }, onChange: (e) => setTtl(Number(e.target.value) || 600) }),
        (0, import_react.createElement)("button", {
          key: "b",
          className: "primary",
          disabled: busy,
          onClick: async () => {
            await run({ op: "pair", body: { ttlSeconds: ttl } }, t("pair.ready"));
          }
        }, t("pair.make")),
        (0, import_react.createElement)("span", { key: "s", className: "muted" }, t("pair.ttl"))
      ]),
      secret ? (0, import_react.createElement)("div", { key: "pair2", className: "pair" }, [
        // слева — действие, а не текст ссылки: копировать в буфер удобнее,
        // чем выделять строку на телефоне
        (0, import_react.createElement)("div", { key: "l", className: "pane" }, [
          (0, import_react.createElement)("div", { key: "t", className: "muted" }, t("pair.linkReady")),
          (0, import_react.createElement)("button", {
            key: "copy",
            className: "primary",
            onClick: async () => {
              try {
                await navigator.clipboard.writeText(secret);
                say(t("pair.copied"), "good");
              } catch {
                say(t("pair.copyFailed"), "bad");
              }
            }
          }, t("pair.copy")),
          (0, import_react.createElement)("div", { key: "n", className: "muted", style: { marginTop: 8 } }, t("pair.note"))
        ]),
        (0, import_react.createElement)("div", { key: "qr", className: "pane qr" }, [
          secret ? renderQr(secret) : null
        ])
      ]) : null
    ]),
    (0, import_react.createElement)("section", { key: "nodes", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, `${t("nodes.title")} (${nodes.length})`),
      nodes.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, t("nodes.none")) : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "i" }, "id"),
          (0, import_react.createElement)("th", { key: "n" }, t("nodes.name")),
          (0, import_react.createElement)("th", { key: "a" }, "API"),
          (0, import_react.createElement)("th", { key: "d" }, t("nodes.access")),
          (0, import_react.createElement)("th", { key: "x" }, "")
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, nodes.flatMap((node) => {
          const row2 = (0, import_react.createElement)(NodeRow, {
            key: `row-${node.id}`,
            node,
            busy,
            onEdit: (id) => {
              setEditorError("");
              setEditing((current) => current === id ? null : id);
            },
            onRevoke: (id) => {
              if (typeof window !== "undefined" && !window.confirm(t("confirm.revoke", { id }))) return;
              setSecret(null);
              run({ op: "token", id }, t("nodes.tokenReissued"));
            },
            onDelete: (id) => {
              if (typeof window !== "undefined" && !window.confirm(`\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443\u0437\u0435\u043B ${id}?`)) return;
              if (editing === id) setEditing(null);
              run({ op: "delete", id }, t("nodes.deleted"));
            }
          });
          if (editing !== node.id) return [row2];
          return [
            (0, import_react.createElement)("tr", { key: `editor-${node.id}` }, (0, import_react.createElement)("td", { colSpan: 5, style: { padding: "4px 8px 12px" } }, (0, import_react.createElement)(NodeEditor, {
              node,
              busy,
              error: editorError,
              onCancel: () => {
                setEditorError("");
                setEditing(null);
              },
              onSave: async (id, body) => {
                const taken = nodes.find((other) => other.id !== id && other.aliases.some((alias) => alias.toLowerCase() === String(body.name).toLowerCase()));
                if (taken) {
                  setEditorError(t("err.nameTaken", { name: body.name, id: taken.id, owner: taken.name }));
                  return;
                }
                const result = await run({ op: "update", id, body }, t("nodes.saved"));
                if (result.ok) {
                  setEditorError("");
                  setEditing(null);
                } else setEditorError(result.error);
              }
            }))),
            row2
          ];
        }))
      ])
    ]),
    tip ? (0, import_react.createElement)("div", {
      key: "tip",
      className: "tipbox",
      style: { left: `${Math.round(tip.x)}px`, top: `${Math.round(tip.y)}px`, transform: "translateX(-50%)" }
    }, tip.text) : null,
    (0, import_react.createElement)("section", { key: "api", style: only("api") }, [
      (0, import_react.createElement)("h3", { key: "h" }, t("api.title")),
      catalog.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, t("api.empty")) : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "h" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "n" }, t("api.name")),
          (0, import_react.createElement)("th", { key: "v" }, t("api.version")),
          (0, import_react.createElement)("th", { key: "c" }, t("api.nodes"))
        ])),
        (0, import_react.createElement)("tbody", { key: "b" }, catalog.flatMap((api) => {
          const open = expanded === api.id;
          const rows = [(0, import_react.createElement)("tr", {
            key: "r" + api.id,
            style: { cursor: "pointer" },
            onClick: () => setExpanded(open ? null : api.id)
          }, [
            (0, import_react.createElement)("td", { key: "n" }, (0, import_react.createElement)("code", null, api.name)),
            (0, import_react.createElement)("td", { key: "v" }, String(api.version)),
            (0, import_react.createElement)("td", { key: "c" }, api.nodes.map((node) => node.name).join(", ") || "\u2014")
          ])];
          if (!open) return rows;
          rows.push((0, import_react.createElement)("tr", { key: "d" + api.id }, (0, import_react.createElement)("td", { colSpan: 3 }, [
            (0, import_react.createElement)("div", { key: "d", className: "muted" }, api.description ?? ""),
            (0, import_react.createElement)("ul", { key: "m" }, api.methods.map((method) => (0, import_react.createElement)("li", { key: method.method }, [
              (0, import_react.createElement)("code", { key: "c" }, method.method),
              method.description ? (0, import_react.createElement)("span", { key: "s", className: "muted" }, " \u2014 " + method.description) : null,
              method.args ? (0, import_react.createElement)("div", { key: "a", className: "muted" }, Object.keys(method.args).join(", ")) : null
            ]))),
            (0, import_react.createElement)(
              "div",
              { key: "who", className: "muted" },
              t("api.exporters") + api.nodes.map((node) => `${node.name}${node.online ? " \u25CF" : ""}`).join(", ")
            )
          ])));
          return rows;
        }))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "audit", style: only("audit") }, [
      (0, import_react.createElement)("h3", { key: "h" }, t("audit.title")),
      audit.length === 0 ? (0, import_react.createElement)("div", { key: "e", className: "empty" }, t("audit.empty")) : (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("thead", { key: "head" }, (0, import_react.createElement)("tr", null, [
          (0, import_react.createElement)("th", { key: "w" }, t("audit.when")),
          (0, import_react.createElement)("th", { key: "k" }, t("audit.what")),
          (0, import_react.createElement)("th", { key: "n" }, t("audit.node")),
          (0, import_react.createElement)("th", { key: "m" }, t("audit.mode")),
          (0, import_react.createElement)("th", { key: "c" }, t("audit.command"))
        ])),
        (0, import_react.createElement)("tbody", { key: "body" }, audit.map((row2) => (0, import_react.createElement)("tr", { key: row2.id }, [
          (0, import_react.createElement)("td", { key: "w", className: "muted" }, new Date(row2.at).toLocaleTimeString()),
          (0, import_react.createElement)("td", { key: "k" }, row2.kind === "denied" ? (0, import_react.createElement)("span", { style: { color: "#ef4444" } }, t("audit.denied")) : row2.kind === "approve" ? `${row2.outcome === "approved" ? t("audit.approved") : t("audit.rejected")}` : t("audit.exec")),
          (0, import_react.createElement)("td", { key: "n" }, row2.nodeName ? [row2.nodeName, (0, import_react.createElement)("span", { key: "id", className: "muted" }, ` #${row2.node}`)] : "\u2014"),
          (0, import_react.createElement)("td", { key: "m" }, (0, import_react.createElement)("code", null, row2.mode ?? "\u2014")),
          (0, import_react.createElement)("td", { key: "c" }, (0, import_react.createElement)("code", null, String(row2.command ?? "").slice(0, 120)))
        ])))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "create", style: only("connections") }, [
      (0, import_react.createElement)("h3", { key: "h" }, t("nodes.new")),
      (0, import_react.createElement)("div", { key: "r", className: "row" }, [
        (0, import_react.createElement)("input", { key: "i", value: newName, placeholder: t("nodes.namePlaceholder"), style: { width: 220 }, onChange: (e) => setNewName(e.target.value) }),
        (0, import_react.createElement)("button", {
          key: "b",
          disabled: busy || !newName.trim(),
          onClick: () => {
            run({ op: "create", body: { name: newName.trim() } }, t("nodes.created"));
            setNewName("");
          }
        }, t("nodes.create"))
      ])
    ]),
    (0, import_react.createElement)("section", { key: "settings", style: only("settings") }, [
      (0, import_react.createElement)("h3", { key: "h" }, t("tab.settings")),
      (0, import_react.createElement)(
        "div",
        { key: "note", className: "muted" },
        t("settings.note")
      ),
      settings ? (0, import_react.createElement)("table", { key: "t" }, [
        (0, import_react.createElement)("tbody", { key: "b" }, [
          row(t("settings.selfSession"), t("settings.selfAlways")),
          row(
            t("settings.selfExtra"),
            (settings.selfRoots ?? []).length ? settings.selfRoots.join(", ") : t("settings.selfOff")
          ),
          row(t("settings.wait"), t("common.waitForever", { value: settings.approvalWaitSeconds })),
          row(t("settings.ttl"), t("common.seconds", { value: settings.approvalTtlSeconds })),
          row(t("settings.alive"), t("common.seconds", { value: settings.aliveTimeoutSeconds })),
          row(t("settings.ping"), settings.wsPingSeconds ? t("common.seconds", { value: settings.wsPingSeconds }) : t("settings.off"))
        ])
      ]) : (0, import_react.createElement)("div", { className: "muted" }, t("settings.failed")),
      (0, import_react.createElement)(
        "div",
        { key: "selfnote", className: "muted", style: { marginTop: 8 } },
        t("settings.selfNote")
      )
    ])
  ]);
}
var name = "dsh-nodes";
var inject = ["slots", "locale"];
var Boundary = class extends Base {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    try {
      console.error("[dsh-nodes] \u043F\u0430\u043D\u0435\u043B\u044C \u0443\u043F\u0430\u043B\u0430:", error);
    } catch {
    }
  }
  render() {
    if (this.state.error) {
      return (0, import_react.createElement)("div", { className: "msg bad" }, `\u043F\u0430\u043D\u0435\u043B\u044C dsh-nodes \u0443\u043F\u0430\u043B\u0430: ${this.state.error?.message ?? this.state.error}`);
    }
    return this.props.children;
  }
};
var translate = (key, vars) => {
  const text = String(ru[key] ?? en[key] ?? key);
  if (vars) return text.replace(/\{(\w+)\}/g, (_, name2) => String(vars[name2] ?? `{${name2}}`));
  return text;
};
var t = (key, vars) => translate(key, vars);
function mountLocale(ctx) {
  const locale = ctx?.locale;
  if (typeof locale?.register !== "function" || typeof locale?.bind !== "function") {
    console.warn("[dsh-nodes] \u043B\u043E\u043A\u0430\u043B\u044C \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430: \u0441\u0442\u0440\u043E\u043A\u0438 \u0431\u0435\u0440\u0443\u0442\u0441\u044F \u0438\u0437 \u0441\u0432\u043E\u0435\u0433\u043E \u0441\u043B\u043E\u0432\u0430\u0440\u044F");
    return;
  }
  const install = () => {
    try {
      locale.addLanguage({ id: "ru", label: "\u0420\u0443\u0441\u0441\u043A\u0438\u0439", fallback: "en" });
    } catch (error) {
      if (!/already/i.test(String(error?.message ?? error))) {
        console.warn("[dsh-nodes] \u044F\u0437\u044B\u043A ru \u043D\u0435 \u043E\u0431\u044A\u044F\u0432\u043B\u0435\u043D:", error);
      }
    }
    try {
      locale.register(NS, { en, ru, zh });
    } catch (error) {
      console.warn("[dsh-nodes] \u0441\u043B\u043E\u0432\u0430\u0440\u0438 \u043D\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u044B:", error);
    }
  };
  try {
    if (typeof ctx?.effect === "function") ctx.effect(install, "dsh-nodes: dictionaries");
    else install();
  } catch (error) {
    console.warn("[dsh-nodes] \u0441\u043B\u043E\u0432\u0430\u0440\u0438 \u043D\u0435 \u0437\u0430\u0440\u0435\u0433\u0438\u0441\u0442\u0440\u0438\u0440\u043E\u0432\u0430\u043D\u044B:", error);
  }
  try {
    translate = locale.bind(NS);
  } catch (error) {
    console.warn("[dsh-nodes] \u043F\u0435\u0440\u0435\u0432\u043E\u0434 \u043D\u0435 \u043F\u0440\u0438\u0432\u044F\u0437\u0430\u043D:", error);
  }
}
function apply(ctx) {
  try {
    const disposeStyles = mountStyles();
    if (typeof ctx?.effect === "function") ctx.effect(() => disposeStyles);
    mountLocale(ctx);
    const slots = ctx?.slots;
    if (!slots?.register) {
      console.warn("[dsh-nodes] \u0441\u043B\u043E\u0442\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B: \u043F\u0430\u043D\u0435\u043B\u044C \u043D\u0435 \u0441\u043C\u043E\u043D\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0430");
      return;
    }
    slots.inject("settings.section", () => slots.register(
      { name: "settings.section", id: "dsh-nodes", order: 35, locale: NS, label: () => t("nodes.title") },
      // панель завёрнута в ловушку: ошибка рендера покажет текст, а не пустоту
      () => (0, import_react.createElement)(Boundary, null, (0, import_react.createElement)(NodesPanel, null))
    ));
  } catch (error) {
    console.warn("[dsh-nodes] \u043A\u043B\u0438\u0435\u043D\u0442\u0441\u043A\u0430\u044F \u043F\u043E\u043B\u043E\u0432\u0438\u043D\u0430 \u043D\u0435 \u0441\u043C\u043E\u043D\u0442\u0438\u0440\u043E\u0432\u0430\u043B\u0430\u0441\u044C:", error);
  }
}

    return module.exports;
  }
});
