import { createError, WSQ_ERROR } from 'pouchdb-errors';
import { guardedConsole } from 'pouchdb-utils';
import { isAndroid } from '@nativescript/core';

import { DATABASE } from '.';

import {
  BY_SEQ_STORE,
  ATTACH_STORE,
  ATTACH_AND_SEQ_STORE
} from './constants';

// escapeBlob and unescapeBlob are workarounds for a websql bug:
// https://code.google.com/p/chromium/issues/detail?id=422690
// https://bugs.webkit.org/show_bug.cgi?id=137637
// The goal is to never actually insert the \u0000 character
// in the database.
function escapeBlob(str) {
  console.log("[pdb-utils]","escapeBlob")
  /* eslint-disable no-control-regex */
  return str
    .replace(/\u0002/g, '\u0002\u0002')
    .replace(/\u0001/g, '\u0001\u0002')
    .replace(/\u0000/g, '\u0001\u0001');
  /* eslint-enable no-control-regex */
}

function unescapeBlob(str) {
  console.log("[pdb-utils]","unescapeBlob")
  /* eslint-disable no-control-regex */
  return str
    .replace(/\u0001\u0001/g, '\u0000')
    .replace(/\u0001\u0002/g, '\u0001')
    .replace(/\u0002\u0002/g, '\u0002');
  /* eslint-enable no-control-regex */
}

async function dbExecuteSql(sql, args, cb, cb2) {
  // console.log(sql, args);
  // try {
    if( sql.startsWith('SELECT') ) {
      const result = await DATABASE.select(sql, args);
      cb(DATABASE, result);
    } else if( sql.startsWith('INSERT')) {
      const t = await DATABASE.execute(sql, args);
      const result = await DATABASE.select(`SELECT last_insert_rowid();`);
      cb(DATABASE, result[0]['last_insert_rowid()']);
    } else {
      const result = await DATABASE.execute(sql, args);
      console.log(result);
      cb(DATABASE, result);
    }
  // }
  // catch(err) {
  //   cb2();
  // }
}

function stringifyDoc(doc) {
  console.log("[pdb-utils]","stringifyDoc")
  // don't bother storing the id/rev. it uses lots of space,
  // in persistent map/reduce especially
  delete doc._id;
  delete doc._rev;
  const res = JSON.stringify(doc);
  console.log(res);
  return res;
}

function unstringifyDoc(doc, id, rev) {
  console.log("[pdb-utils]","unstringifyDoc")
  doc = JSON.parse(doc);
  doc._id = id;
  doc._rev = rev;
  return doc;
}

// question mark groups IN queries, e.g. 3 -> '(?,?,?)'
function qMarks(num) {
  console.log("[pdb-utils]","qMarks")
  var s = '(';
  while (num--) {
    s += '?';
    if (num) {
      s += ',';
    }
  }
  return s + ')';
}

function uuid() {
  console.log("[pdb-utils]","uuid")
  if( isAndroid ) {
    console.log('uuid');
    return java.util.UUID.randomUUID().toString();
  } else {
    return NSUUID.UUID().UUIDString.toLowerCase();
  }
}

function select(selector, table, joiner, where, orderBy) {
  console.log("[pdb-utils]","select")
  return 'SELECT ' + selector + ' FROM ' +
    (typeof table === 'string' ? table : table.join(' JOIN ')) +
    (joiner ? (' ON ' + joiner) : '') +
    (where ? (' WHERE ' +
    (typeof where === 'string' ? where : where.join(' AND '))) : '') +
    (orderBy ? (' ORDER BY ' + orderBy) : '');
}

function compactRevs(revs, docId, tx) {
  console.log("[pdb-utils]","compactRevs")

  if (!revs.length) {
    return;
  }

  var numDone = 0;
  var seqs = [];

  function checkDone() {
    if (++numDone === revs.length) { // done
      deleteOrphans();
    }
  }

  function deleteOrphans() {
    // find orphaned attachment digests

    if (!seqs.length) {
      return;
    }

    var sql = 'SELECT DISTINCT digest AS digest FROM ' +
      ATTACH_AND_SEQ_STORE + ' WHERE seq IN ' + qMarks(seqs.length);

    dbExecuteSql(sql, seqs, function (tx, res) {

      var digestsToCheck = [];
      for (var i = 0; i < res.rows.length; i++) {
        digestsToCheck.push(res.rows.item(i).digest);
      }
      if (!digestsToCheck.length) {
        return;
      }

      var sql = 'DELETE FROM ' + ATTACH_AND_SEQ_STORE +
        ' WHERE seq IN (' +
        seqs.map(function () { return '?'; }).join(',') +
        ')';
      dbExecuteSql(sql, seqs, function (tx) {

        var sql = 'SELECT digest FROM ' + ATTACH_AND_SEQ_STORE +
          ' WHERE digest IN (' +
          digestsToCheck.map(function () { return '?'; }).join(',') +
          ')';
        dbExecuteSql(sql, digestsToCheck, function (tx, res) {
          var nonOrphanedDigests = new Set();
          for (var i = 0; i < res.rows.length; i++) {
            nonOrphanedDigests.add(res.rows.item(i).digest);
          }
          digestsToCheck.forEach(function (digest) {
            if (nonOrphanedDigests.has(digest)) {
              return;
            }
            dbExecuteSql(
              'DELETE FROM ' + ATTACH_AND_SEQ_STORE + ' WHERE digest=?',
              [digest]);
            dbExecuteSql(
              'DELETE FROM ' + ATTACH_STORE + ' WHERE digest=?', [digest]);
          });
        });
      });
    });
  }

  // update by-seq and attach stores in parallel
  revs.forEach(function (rev) {
    var sql = 'SELECT seq FROM ' + BY_SEQ_STORE +
      ' WHERE doc_id=? AND rev=?';

    dbExecuteSql(sql, [docId, rev], function (tx, res) {
      if (!res.length) { // already deleted
        return checkDone();
      }
      var seq = res[0].seq;
      seqs.push(seq);

      dbExecuteSql(
        'DELETE FROM ' + BY_SEQ_STORE + ' WHERE seq=?', [seq], checkDone);
    });
  });
}

function websqlError(callback) {
  console.log('websqlError!');
  return function (event) {
    guardedConsole('error', 'WebSQL threw an error', event);
    // event may actually be a SQLError object, so report is as such
    var errorNameMatch = event && event.constructor.toString()
        .match(/function ([^(]+)/);
    var errorName = (errorNameMatch && errorNameMatch[1]) || event.type;
    var errorReason = event.target || event.message;
    callback(createError(WSQ_ERROR, errorReason, errorName));
  };
}

function getSize(opts) {
  console.log("[pdb-utils]","getSize")
  if ('size' in opts) {
    // triggers immediate popup in iOS, fixes #2347
    // e.g. 5000001 asks for 5 MB, 10000001 asks for 10 MB,
    return opts.size * 1000000;
  }
  // In iOS, doesn't matter as long as it's <= 5000000.
  // Except that if you request too much, our tests fail
  // because of the native "do you accept?" popup.
  // In Android <=4.3, this value is actually used as an
  // honest-to-god ceiling for data, so we need to
  // set it to a decently high number.
  var isAndroid = typeof navigator !== 'undefined' &&
    /Android/.test(navigator.userAgent);
  return isAndroid ? 5000000 : 1; // in PhantomJS, if you use 0 it will crash
}

export {
  escapeBlob,
  unescapeBlob,
  stringifyDoc,
  unstringifyDoc,
  qMarks,
  select,
  compactRevs,
  getSize,
  websqlError,
  uuid,
  dbExecuteSql
};
