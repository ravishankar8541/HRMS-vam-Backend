const Delivery = require('../models/DocumentDelivery');
const SalarySlip = require('../models/SalarySlip');
const mongoose = require('mongoose');
const {ensure,readPDF}=require('../utils/documentArchive');
const ensureMonthlySalarySlips = require('../utils/monthlySalarySlips');
const errorStatus = require('../utils/errorStatus');
const { sendSalarySlipRecord } = require('./salaryController');
const isStaff = user => ['admin','hr'].includes(user.role);
const scope = user => ({deletedAt: null, ...(isStaff(user) ? {} : {recipient:String(user.email || '').trim().toLowerCase(),status:'Sent'})});

const pendingSalarySlips = async query => {
 const archived = new Set((await Delivery.distinct('sourceId',{docType:'Salary Slip'})).filter(Boolean).map(String));
 const slips = await SalarySlip.find({hiddenAt:null}).lean();
 const search = String(query.search || '').toLowerCase();
 const from = query.from ? new Date(String(query.from)) : null;
 let to = query.to ? new Date(String(query.to)) : null;
 if (to) to = new Date(to.getTime() + 86400000);
 const email = String(query.email || '').trim().toLowerCase();
 return slips
  .filter(s => !archived.has(String(s._id)))
  .filter(s => !email || String(s.employeeEmail || '').toLowerCase() === email)
  .filter(s => !query.status || query.status === 'Pending')
  .filter(s => !search || [s.employeeName,s.monthYear,s.employeeEmail].some(v => String(v || '').toLowerCase().includes(search)))
  .filter(s => {
   const created = new Date(s.createdAt);
   if (from && created < from) return false;
   if (to && created >= to) return false;
   return true;
  })
  .map(s => ({...s,_id:s._id,sourceId:String(s._id),docType:'Salary Slip',recipient:s.employeeEmail,email:s.employeeEmail,refNo:s.monthYear,date:s.createdAt,createdAt:s.createdAt,status:'Pending',archived:false}));
};

exports.getAllDocuments = async (req, res) => {
 const staff = isStaff(req.user);
 const salaryView = !req.query.type || ['ALL','Salary Slip'].includes(String(req.query.type));
 const filter = scope(req.user);
 if (staff && req.query.email) filter.recipient=String(req.query.email).trim().toLowerCase();
 if (staff && req.query.status) filter.status=String(req.query.status);
 if (req.query.from || req.query.to) {
  filter.createdAt={};
  for(const [key,operator] of [['from','$gte'],['to','$lt']]) if(req.query[key]) {
   const date=new Date(String(req.query[key]));
   if(!Number.isFinite(date.getTime())) return res.status(400).json({message:'Invalid date filter'});
   if(key==='to')date.setUTCDate(date.getUTCDate()+1);
   filter.createdAt[operator]=date;
  }
 }
 if (req.query.type && req.query.type !== 'ALL') filter.docType = String(req.query.type);
 if (staff && salaryView) await ensureMonthlySalarySlips();
 const docs = await Delivery.find(filter).select('-publicId -snapshotKey -__v').sort({createdAt:-1}).lean();
 const search = String(req.query.search || '').toLowerCase();
 const data = docs.filter(d => !search || [d.employeeName,d.refNo,d.recipient].some(v => String(v || '').toLowerCase().includes(search)))
 .map(d => ({...d,email:d.recipient,date:d.sentAt || d.createdAt}));
 if (staff && salaryView) data.push(...await pendingSalarySlips(req.query));
 data.sort((a,b) => new Date(b.date) - new Date(a.date));
 res.set('Cache-Control','private, no-store').json({success:true,count:data.length,data});
};
exports.previewDocumentPDF = async (req,res) => {
 if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({message:'Invalid document ID'});
 const doc = await Delivery.findOne({...scope(req.user),_id:req.params.id,docType:req.params.type}).lean();
 if (!doc) return res.status(404).json({message:'Document not found'});
 const buffer = await readPDF(doc);
 res.set({'Content-Type':'application/pdf','Cache-Control':'private, no-store','Content-Disposition':'inline; filename="document.pdf"'}).send(buffer);
};
// Delivery rows can share one PDF asset. Remove only this vault entry.
const removeVaultEntry = async (type, id) => {
 const doc = await Delivery.findOneAndUpdate({_id:id,docType:type,deletedAt:null}, {$set:{deletedAt:new Date()}}, {new:true});
 if (doc) {
  if (doc.docType === 'Salary Slip' && mongoose.isValidObjectId(doc.sourceId))
   await SalarySlip.updateOne({_id:doc.sourceId,hiddenAt:null},{$set:{hiddenAt:new Date()}});
  return 'delivery';
 }
 // Auto-prepared payslips do not have a delivery row yet.
 if (type === 'Salary Slip') {
  const slip = await SalarySlip.findOneAndUpdate({_id:id,hiddenAt:null},{$set:{hiddenAt:new Date()}},{new:true});
  if (slip) return 'slip';
 }
 return 'missing';
};
exports.deleteDocument = async (req,res) => {
 if (!isStaff(req.user)) return res.status(403).json({message:'HR access required'});
 if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({message:'Invalid document ID'});
 const removed = await removeVaultEntry(req.params.type, req.params.id);
 if (removed === 'delivery') return res.json({success:true,message:'Document removed from the vault'});
 if (removed === 'slip') return res.json({success:true,message:'Salary slip removed from the vault'});
 return res.status(404).json({message:'Document not found'});
};
exports.bulkDeleteDocuments = async (req,res) => {
 if (!isStaff(req.user)) return res.status(403).json({message:'HR access required'});
 const items = req.body.documents;
 if (!Array.isArray(items) || !items.length || items.length > 100
  || items.some(i => !i || typeof i.docType !== 'string' || !mongoose.isValidObjectId(i._id)))
  return res.status(400).json({message:'Select 1–100 valid documents'});
 let removed = 0;
 for (const item of items) if (await removeVaultEntry(item.docType, String(item._id)) !== 'missing') removed += 1;
 const missing = items.length - removed;
 if (!removed) return res.status(404).json({message:'Documents not found'});
 return res.json({success:true,removed,missing,message:missing
  ? `${removed} documents removed from the vault; ${missing} were already gone`
  : `${removed} documents removed from the vault`});
};
exports.bulkDownload = async (req,res) => {
 const items = req.body.documents;
 if (!Array.isArray(items) || !items.length || items.length > 25 || items.some(i=>!mongoose.isValidObjectId(i._id))) return res.status(400).json({message:'Select 1–25 valid documents'});
 const ids = items.map(i=>String(i._id));
 const docs = await Delivery.find({...scope(req.user),_id:{$in:ids}}).lean();
 const byId = new Map(docs.map(d=>[String(d._id),d]));
 if (isStaff(req.user)) for (const item of items) {
  const key = String(item._id);
  if (byId.has(key) || item.docType !== 'Salary Slip') continue;
  const record = await SalarySlip.findById(key);
  if (!record) continue;
  byId.set(key, await ensure('Salary Slip', record));
 }
 if (byId.size !== new Set(ids).size) return res.status(404).json({message:'Document not found'});
 // Authorize and fetch everything before streaming; never silently omit failed files.
 const buffers=[]; for (const id of ids) buffers.push(await readPDF(byId.get(id)));
 const { ZipArchive } = await import('archiver');
 const archive = new ZipArchive({zlib:{level:1}});
 archive.on('error',err=>res.destroy(err));
 res.on('close',()=>archive.abort());
 res.set('Cache-Control','private, no-store').attachment('Documents.zip'); archive.pipe(res);
 items.forEach((item,i)=>archive.append(buffers[i],{name:item._id+'_'+String(byId.get(String(item._id)).filename||'').replace(/[^a-zA-Z0-9_.-]/g,'_')}));
 await archive.finalize();
};
exports.scope = scope;

exports.getDocumentSource = async (req,res) => {
 if (!isStaff(req.user)) return res.status(403).json({message:'HR access required'});
 if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({message:'Invalid document ID'});
 const models={'Onboarding Report':'Employee','Offer Letter':'OfferLetter','Appointment Letter':'AppointmentLetter','Increment Letter':'IncrementLetter','Salary Slip':'SalarySlip','Termination Letter':'TerminationLetter','FNF Settlement':'FNF'};
 const model=models[req.params.type];
 if (!model) return res.status(404).json({message:'The source for this document is no longer available'});
 const doc = await Delivery.findOne({_id:req.params.id,docType:req.params.type,deletedAt:null}).lean();
 // Payslips prepared automatically for the vault use the SalarySlip ID until archived.
 const sourceId = doc ? doc.sourceId : (req.params.type === 'Salary Slip' ? req.params.id : null);
 if (!sourceId || !mongoose.isValidObjectId(sourceId)) return res.status(404).json({message:'The source for this document is no longer available'});
 const record = await require('../models/'+model).findById(sourceId).lean();
 if (!record || record.deletedAt) return res.status(404).json({message:'The source for this document is no longer available'});
 res.set('Cache-Control','private, no-store').json({success:true,data:record});
};

exports.previewSource = async (req,res) => {
 const models={'Onboarding Report':'Employee','Offer Letter':'OfferLetter','Appointment Letter':'AppointmentLetter','Increment Letter':'IncrementLetter','Salary Slip':'SalarySlip','Termination Letter':'TerminationLetter','FNF Settlement':'FNF'};
 const model=models[req.params.type];
 if(!model || !mongoose.isValidObjectId(req.params.id)) return res.status(400).json({message:'Invalid document'});
 const record=await require('../models/'+model).findById(req.params.id);
 if(!record || record.deletedAt) return res.status(404).json({message:'Document not found'});
 const snapshot=await ensure(req.params.type,record);
 res.set({'Content-Type':'application/pdf','X-Document-Id':String(snapshot._id),'Cache-Control':'private, no-store','Content-Disposition':'inline; filename="document.pdf"'}).send(await readPDF(snapshot));
};

exports.sendSalarySlip = async (req,res) => {
 if (!isStaff(req.user)) return res.status(403).json({message:'HR access required'});
 if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({message:'Invalid document ID'});
 let record = await SalarySlip.findById(req.params.id);
 if (!record) {
  const delivery = await Delivery.findOne({_id:req.params.id,docType:'Salary Slip',deletedAt:null}).lean();
  if (delivery && mongoose.isValidObjectId(delivery.sourceId)) record = await SalarySlip.findById(delivery.sourceId);
 }
 if (!record || record.deletedAt) return res.status(404).json({success:false,message:'Salary slip not found'});
 try {
  await sendSalarySlipRecord(record);
  return res.json({success:true,message:`Salary slip emailed to ${record.employeeEmail}`,email:record.employeeEmail});
 } catch (err) {
  console.error('Vault salary slip email error:', err);
  return res.status(errorStatus(err)).json({success:false,message:'Failed to email salary slip',error:err.message});
 }
};
