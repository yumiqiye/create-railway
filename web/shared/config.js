/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/* 极简 TOML 读取器：只支持 [section] 与 key = "value" / number / boolean */
const fs = require('fs');
const path = require('path');

function parseToml(text) {
  const out = {};
  let section = 'root';
  out[section] = {};
  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const sec = trimmed.match(/^\[([^\]]+)\]$/);
      if (sec) {
        section = sec[1].trim();
        out[section] = out[section] || {};
        return;
      }
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value === 'true' || value === 'false') value = value === 'true';
      else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
      out[section][key] = value;
    });
  return out;
}

function loadConfig(startDir) {
  const file = path.join(startDir, 'config.toml');
  if (!fs.existsSync(file)) return {};
  try {
    return parseToml(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('读取 config.toml 失败：', e.message);
    return {};
  }
}

module.exports = { parseToml, loadConfig };
