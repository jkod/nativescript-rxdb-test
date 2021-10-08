'use strict'

var WebSqlPouchCore = require('../pouchdb-adapter-websql-core').default
import { openOrCreate, SQLiteDatabase } from '@akylas/nativescript-sqlite';
import { knownFolders, path } from '@nativescript/core';

function createOpenDBFunction(opts) {
  return function (name, version, description, size) {
    // The SQLite Plugin started deviating pretty heavily from the
    // standard openDatabase() function, as they started adding more features.
    // It's better to just use their "new" format and pass in a big ol'
    // options object. Also there are many options here that may come from
    // the PouchDB constructor, so we have to grab those.
    var openOpts = Object.assign({}, opts, {
      name: name,
      version: version,
      description: description,
      size: size
    })
    function onError (err) {
      console.error(err)
      if (typeof opts.onError === 'function') {
        opts.onError(err)
      }
    }

    console.log("Opening ", openOpts.name);

    const db = openOrCreate(path.join(knownFolders.documents().getFolder('db').path, `${openOpts.name}.sqlite`));

    // db.execute('CREATE TABLE names (id INT, name TEXT, PRIMARY KEY (id))').then((res)=> {
    //   console.log('res:', res);
    // })
    // console.log('response', res);
    // const db = sqlite(openOpts.name);
    console.log( 'db is : ', db.isOpen );
    // const db = await new sqlite.SQLite(openOpts.name);
    return db;
    // return sqlite.openDatabase(openOpts.name, openOpts.version, openOpts.description, openOpts.size, null, onError)
  }
}

function NativescriptSQLitePouch (opts, callback) {
  var websql = createOpenDBFunction(opts)
  var _opts = Object.assign({
    websql: websql
  }, opts)

  WebSqlPouchCore.call(this, _opts, callback)
}

NativescriptSQLitePouch.valid = function () {
  // if you're using ReactNative, we assume you know what you're doing because you control the environment
  return true
}

// no need for a prefix in ReactNative (i.e. no need for `_pouch_` prefix
NativescriptSQLitePouch.use_prefix = false

function nativescriptSqlitePlugin(PouchDB) {
  console.log('pouch plugin');
  PouchDB.adapter('nativescript-sqlite', NativescriptSQLitePouch, true)
  console.log('pouch plugin done');
}

export function createPlugin() {
  console.log("create Plugin!")
  return nativescriptSqlitePlugin
}

