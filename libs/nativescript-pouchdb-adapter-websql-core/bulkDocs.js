import {
  preprocessAttachments,
  isLocalId,
  processDocs,
  parseDoc
} from 'pouchdb-adapter-utils';
import {
  compactTree
} from 'pouchdb-merge';
import {
  safeJsonParse,
  safeJsonStringify
} from 'pouchdb-json';
import {
  MISSING_STUB,
  createError
} from 'pouchdb-errors';

import {
  DOC_STORE,
  BY_SEQ_STORE,
  ATTACH_STORE,
  ATTACH_AND_SEQ_STORE
} from './constants';

import {
  select,
  stringifyDoc,
  compactRevs,
  websqlError,
  escapeBlob,
  dbExecuteSql
} from './utils';

function websqlBulkDocs(dbOpts, req, opts, api, db, websqlChanges, callback) {
  var newEdits = opts.new_edits;
  var userDocs = req.docs;

  // Parse the docs, give them a sequence number for the result
  var docInfos = userDocs.map(function (doc) {
    if (doc._id && isLocalId(doc._id)) {
      return doc;
    }
    var newDoc = parseDoc(doc, newEdits, dbOpts);
    return newDoc;
  });

  var docInfoErrors = docInfos.filter(function (docInfo) {
    return docInfo.error;
  });
  if (docInfoErrors.length) {
    return callback(docInfoErrors[0]);
  }

  var tx;
  console.log(docInfos);
  var results = new Array(docInfos.length);
  var fetchedDocs = new Map();

  var preconditionErrored;
  function complete() {
    console.log('[bulkDocs]complete');
    if (preconditionErrored) {
      return callback(preconditionErrored);
    }
    websqlChanges.notify(api._name);
    console.log( 'RESULTS:', results, ':(' );
    callback(null, results);
  }

  function verifyAttachment(digest, callback) {
    console.log('[bulkDocs]verifyAttachment');
    var sql = 'SELECT count(*) as cnt FROM ' + ATTACH_STORE +
      ' WHERE digest=?';
    dbExecuteSql(sql, [digest], function (tx, result) {
      if (result[0].cnt === 0) {
        var err = createError(MISSING_STUB,
          'unknown stub attachment with digest ' +
          digest);
        callback(err);
      } else {
        callback();
      }
    });
  }

  function verifyAttachments(finish) {
    console.log('[bulkDocs]verifyAttachments');
    var digests = [];
    docInfos.forEach(function (docInfo) {
      if (docInfo.data && docInfo.data._attachments) {
        Object.keys(docInfo.data._attachments).forEach(function (filename) {
          var att = docInfo.data._attachments[filename];
          if (att.stub) {
            digests.push(att.digest);
          }
        });
      }
    });
    if (!digests.length) {
      return finish();
    }
    var numDone = 0;
    var err;

    function checkDone() {
      console.log('[bulkDocs]checkDone');
      if (++numDone === digests.length) {
        finish(err);
      }
    }
    digests.forEach(function (digest) {
      verifyAttachment(digest, function (attErr) {
        if (attErr && !err) {
          err = attErr;
        }
        checkDone();
      });
    });
  }

  function writeDoc(docInfo, winningRev, winningRevIsDeleted, newRevIsDeleted,
    isUpdate, delta, resultsIdx, callback) {
    console.log('[bulkDocs]writeDoc');

    function finish() {
      console.log('[bulkDocs]finish');
      var data = docInfo.data;
      var deletedInt = newRevIsDeleted ? 1 : 0;

      var id = data._id;
      var rev = data._rev;
      var json = stringifyDoc(data);
      var sql = 'INSERT INTO ' + BY_SEQ_STORE +
        ' (doc_id, rev, json, deleted) VALUES (?, ?, ?, ?);';
      var sqlArgs = [id, rev, json, deletedInt];

      // map seqs to attachment digests, which
      // we will need later during compaction
      function insertAttachmentMappings(seq, callback) {
        console.log('[bulkDocs]insertAttachmentMappings');
        var attsAdded = 0;
        var attsToAdd = Object.keys(data._attachments || {});

        if (!attsToAdd.length) {
          return callback();
        }
        function checkDone() {
          console.log('[bulkDocs]checkDone');
          if (++attsAdded === attsToAdd.length) {
            callback();
          }
          return false; // ack handling a constraint error
        }
        function add(att) {
          console.log('[bulkDocs]add');
          var sql = 'INSERT INTO ' + ATTACH_AND_SEQ_STORE +
            ' (digest, seq) VALUES (?,?)';
          var sqlArgs = [data._attachments[att].digest, seq];
          dbExecuteSql(sql, sqlArgs, checkDone, checkDone)
          // await checkDone();
          // second callback is for a constaint error, which we ignore
          // because this docid/rev has already been associated with
          // the digest (e.g. when new_edits == false)
        }
        for (var i = 0; i < attsToAdd.length; i++) {
          add(attsToAdd[i]); // do in parallel
        }
      }

      dbExecuteSql(sql, sqlArgs, (tx, result) => {
        // var seq = result.insertId;
        var seq = result;
        console.log('SEQ', seq);

        insertAttachmentMappings(seq, function () {
          dataWritten(tx, seq);
        });
      }).catch(function () {
        console.log('constraint error, recover by updating instead (see #1638)');
        var fetchSql = select('seq', BY_SEQ_STORE, null,
          'doc_id=? AND rev=?');
        dbExecuteSql(fetchSql, [id, rev], function (tx, res) {
          var seq = res[0].seq;
          var sql = 'UPDATE ' + BY_SEQ_STORE +
            ' SET json=?, deleted=? WHERE doc_id=? AND rev=?;';
          var sqlArgs = [json, deletedInt, id, rev];
          dbExecuteSql(sql, sqlArgs, function (tx) {
            insertAttachmentMappings(seq, function () {
              dataWritten(tx, seq);
            });
          });
        });
        return false; // ack that we've handled the error
      });
    }

    function collectResults(attachmentErr) {
      console.log('[bulkDocs]collectResults');
      if (!err) {
        if (attachmentErr) {
          err = attachmentErr;
          callback(err);
        } else if (recv === attachments.length) {
          finish();
        }
      }
    }

    var err = null;
    var recv = 0;

    docInfo.data._id = docInfo.metadata.id;
    docInfo.data._rev = docInfo.metadata.rev;
    var attachments = Object.keys(docInfo.data._attachments || {});


    if (newRevIsDeleted) {
      docInfo.data._deleted = true;
    }

    function attachmentSaved(err) {
      console.log('[bulkDocs]attachmentSaved');
      recv++;
      collectResults(err);
    }

    attachments.forEach(function (key) {
      var att = docInfo.data._attachments[key];
      if (!att.stub) {
        var data = att.data;
        delete att.data;
        att.revpos = parseInt(winningRev, 10);
        var digest = att.digest;
        saveAttachment(digest, data, attachmentSaved);
      } else {
        recv++;
        collectResults();
      }
    });

    if (!attachments.length) {
      finish();
    }

    function dataWritten(tx, seq) {
      console.log('[bulkDocs]dataWritten');
      var id = docInfo.metadata.id;
      console.log( 'id',id, docInfo );
      var revsToCompact = docInfo.stemmedRevs || [];
      if (isUpdate && api.auto_compaction) {
        revsToCompact = compactTree(docInfo.metadata).concat(revsToCompact);
      }
      if (revsToCompact.length) {
        compactRevs(revsToCompact, id, tx);
      }


      docInfo.metadata.seq = seq;
      var rev = docInfo.metadata.rev;
      console.log('[bulkdocs]', docInfo);
      delete docInfo.metadata.rev;

      var sql = isUpdate ?
      'UPDATE ' + DOC_STORE +
      ' SET json=?, max_seq=?, winningseq=' +
      '(SELECT seq FROM ' + BY_SEQ_STORE +
      ' WHERE doc_id=' + DOC_STORE + '.id AND rev=?) WHERE id=?'
        : 'INSERT INTO ' + DOC_STORE +
      ' (id, winningseq, max_seq, json) VALUES (?,?,?,?);';
      var metadataStr = safeJsonStringify(docInfo.metadata);
      var params = isUpdate ?
        [metadataStr, seq, winningRev, id] :
        [id, seq, seq, metadataStr];
      dbExecuteSql(sql, params, function () {
        results[resultsIdx] = {
          ok: true,
          id: docInfo.metadata.id,
          rev: rev
        };
        console.log('????',results);
        fetchedDocs.set(id, docInfo.metadata);
        callback();
      });
    }
  }

  function websqlProcessDocs() {
    console.log('[bulkDocs]websqlProcessDocs');
    processDocs(dbOpts.revs_limit, docInfos, api, fetchedDocs, tx,
                results, writeDoc, opts);
  }

  function fetchExistingDocs(callback) {
    console.log('[bulkDocs]fetchExistingDocs');
    if (!docInfos.length) {
      console.log('[bulkDocs]!docInfo');
      return callback();
    }
    console.log(docInfos);

    var numFetched = 0;

    function checkDone() {
      console.log('[bulkDocs]checkDone');
      if (++numFetched === docInfos.length) {
        callback();
      }
    }

    docInfos.forEach(function (docInfo) {
      if (docInfo._id && isLocalId(docInfo._id)) {
        return checkDone(); // skip local docs
      }
      var id = docInfo.metadata.id;
      dbExecuteSql('SELECT json FROM ' + DOC_STORE +
      ' WHERE id = ?', [id], function (db, result) {
        console.log('[bulkDocs]', result);
        if (result.length) {
          var metadata = safeJsonParse(result[0].json);
          console.log('[bulkdocs]metadata', metadata);
          fetchedDocs.set(id, metadata);
        }
        checkDone();
      });
    });
  }

  function saveAttachment(digest, data, callback) {
    console.log('[bulkDocs]saveAttachment');
    var sql = 'SELECT digest FROM ' + ATTACH_STORE + ' WHERE digest=?';
    dbExecuteSql(sql, [digest], function (tx, result) {
      if (result.length) { // attachment already exists
        return callback();
      }
      // we could just insert before selecting and catch the error,
      // but my hunch is that it's cheaper not to serialize the blob
      // from JS to C if we don't have to (TODO: confirm this)
      sql = 'INSERT INTO ' + ATTACH_STORE +
      ' (digest, body, escaped) VALUES (?,?,1)';
      dbExecuteSql(sql, [digest, escapeBlob(data)], function () {
        console.log('Save attachment');
        callback();
      }).then(function () {
        console.log('second callback??');
        console.log('ignore constaint errors, means it already exists');
        callback();
        return false; // ack we handled the error
      });
    });
  }

  preprocessAttachments(docInfos, 'binary', function (err) {
    console.log('[bulkDocs]preprocessAttachments');
    if (err) {
      return callback(err);
    }
    db.transaction(() => {
      verifyAttachments(function (err) {
        if (err) {
          preconditionErrored = err;
        } else {
          fetchExistingDocs(websqlProcessDocs);
        }
      });
    })
    .catch(websqlError(callback))
    .then(complete);
  });
}

export default websqlBulkDocs;
