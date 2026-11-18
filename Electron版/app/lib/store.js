// lib/store.js - 采集记录持久化（SQLite data.db，截图 png 仍在 records/ 目录）
const fs = require('fs');
const path = require('path');
const DB = require('./db');

function initStore(dir) {
  const dataDir = dir;
  const recDir = path.join(dataDir, 'records');
  if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true });
  DB.initDb(dataDir); // 幂等：main.js 已初始化则复用同一连接

  function add(record) { return DB.recAdd(record); }
  function list() { return DB.recList(); }
  function get(id) { return DB.recGet(id); }
  function patch(id, patch) { return DB.recPatch(id, patch); }
  function remove(id) { return DB.recRemove(id); }

  return { add, list, get, remove, patch, recordsDir: recDir };
}

module.exports = { initStore };
