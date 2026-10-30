const { test } = require('node:test');
const assert = require('node:assert/strict');
const Delivery = require('../models/DocumentDelivery');
const documents = require('../controllers/documentController');
const response = () => ({code:200,status(code){this.code=code;return this;},set(){return this;},json(body){this.body=body;return this;}});
const params = {id:'507f1f77bcf86cd799439011',type:'Offer Letter'};

test('employees cannot delete or load editable document sources', async () => {
  for (const action of [documents.deleteDocument, documents.getDocumentSource]) {
    const res = response();
    await action({user:{role:'employee'},params},res);
    assert.equal(res.code,403);
  }
});

test('vault deletion targets one active entry and leaves shared PDF assets intact', async t => {
  t.mock.method(Delivery,'findOneAndUpdate',async (filter,update) => {
    assert.deepEqual(filter,{_id:params.id,docType:params.type,deletedAt:null});
    assert.ok(update.$set.deletedAt instanceof Date);
    return {_id:params.id};
  });
  const res=response();
  await documents.deleteDocument({user:{role:'hr'},params},res);
  assert.equal(res.body.success,true);
});

test('missing and invalid vault entries cannot be deleted', async t => {
  t.mock.method(Delivery,'findOneAndUpdate',async()=>null);
  for (const [id,status] of [[params.id,404],['bad-id',400]]) {
    const res=response();
    await documents.deleteDocument({user:{role:'admin'},params:{...params,id}},res);
    assert.equal(res.code,status);
  }
});

test('bulk vault delete removes every selected entry and counts the ones already gone', async t => {
  const gone = '507f1f77bcf86cd799439012';
  t.mock.method(Delivery, 'findOneAndUpdate', async filter =>
    filter._id === params.id ? { _id: filter._id, docType: filter.docType } : null);
  const res = response();
  await documents.bulkDeleteDocuments({ user: { role: 'hr' }, body: { documents: [
    { _id: params.id, docType: 'Offer Letter' }, { _id: gone, docType: 'Offer Letter' }] } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.removed, 1);
  assert.equal(res.body.missing, 1);
});

test('bulk vault delete rejects non-staff callers and malformed selections', async () => {
  const entries = [
    [{ role: 'employee' }, [{ _id: params.id, docType: 'Offer Letter' }], 403],
    [{ role: 'hr' }, [], 400],
    [{ role: 'hr' }, [{ _id: 'bad-id', docType: 'Offer Letter' }], 400],
    [{ role: 'hr' }, [{ _id: params.id }], 400],
    [{ role: 'hr' }, Array.from({ length: 101 }, (_, i) => ({ _id: params.id, docType: 'Offer Letter', i })), 400],
  ];
  for (const [user, selected, code] of entries) {
    const res = response();
    await documents.bulkDeleteDocuments({ user, body: { documents: selected } }, res);
    assert.equal(res.code, code, JSON.stringify(user));
  }
});

test('deleted entries cannot be previewed, downloaded, or edited', async t => {
  t.mock.method(Delivery,'findOne',filter=>{
    assert.equal(filter.deletedAt,null);
    return {lean:async()=>null};
  });
  t.mock.method(Delivery,'find',filter=>{
    assert.equal(filter.deletedAt,null);
    return {lean:async()=>[]};
  });
  for (const action of [documents.previewDocumentPDF,documents.getDocumentSource,documents.bulkDownload]) {
    const res=response();
    await action({user:{role:'admin'},params,body:{documents:[{_id:params.id}]}},res);
    assert.equal(res.code,404);
  }
});

test('edit resolves the source ID instead of the delivery ID', async t => {
  const sourceId='507f1f77bcf86cd799439022';
  t.mock.method(Delivery,'findOne',()=>({lean:async()=>({sourceId,docType:'Offer Letter'})}));
  t.mock.method(require('../models/OfferLetter'),'findById',id=>{
    assert.equal(id,sourceId);
    return {lean:async()=>({_id:sourceId,employeeName:'Test'})};
  });
  const res=response();
  await documents.getDocumentSource({user:{role:'hr'},params},res);
  assert.equal(res.body.data._id,sourceId);
});
