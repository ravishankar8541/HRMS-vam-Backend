const { createHash } = require('crypto');
const Delivery = require('../models/DocumentDelivery');
const { cloudinary } = require('../config/cloudinary');

const generators = {
  'Onboarding Report': data => require('./onboardingPdfGenerator')(data),
  'Offer Letter': data => require('./pdfGenerator')(data),
  'Appointment Letter': data => require('./appointmentEmailService').generateAppointmentPDFBuffer(data),
  'Increment Letter': data => require('./incrementPdfGenerator')(data),
  'Salary Slip': data => require('./salarySlipPdfGenerator')(data),
  'Termination Letter': data => require('./terminationPdfGenerator')({ ...data, email: data.employeeEmail, phoneNumber: data.employeePhone }),
  'FNF Settlement': data => require('./generateFNFPDF')(data),
};
const inFlight = new Map();
function fingerprint(type, data) {
  const values = { ...data };
  for (const key of ['updatedAt', '__v', 'emailStatus', 'netPayWords']) delete values[key];
  // Regenerate salary snapshots when the template changes; retain past deliveries.
  const templateVersion = type === 'Salary Slip' ? ':template-v3:' : '';
  return createHash('sha256').update(type + templateVersion + JSON.stringify(values, Object.keys(values).sort())).digest('hex');
}
async function readPDF(doc) {
  const url = cloudinary.utils.private_download_url(doc.publicId, '', { resource_type: 'raw', type: 'authenticated', expires_at: Math.floor(Date.now()/1000)+60 });
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Stored document is unavailable');
  return Buffer.from(await response.arrayBuffer());
}
async function createSnapshot(type, data, snapshotKey) {
  const existing = await Delivery.findOne({ snapshotKey });
  if (existing) return existing;
  const buffer = await generators[type](data);
  const asset = await new Promise((resolve,reject) => cloudinary.uploader.upload_stream({ resource_type:'raw', type:'authenticated', folder:'hrms/documents' },
    (error,result)=>error?reject(error):resolve(result)).end(buffer));
  try {
    return await Delivery.create({ snapshotKey, sourceId: String(data._id), docType:type,
      employeeName:data.employeeName || data.name, recipient:data.email || data.emailId || data.employeeEmail,
      filename:`${type.replaceAll(' ','_')}_${String(data.employeeName || data.name).replace(/[^a-zA-Z0-9_-]/g,'_')}.pdf`,
      refNo:data.offerId || data.incrementId || data.monthYear || data.employeeId || String(data._id),
      publicId:asset.public_id, status:'Generated' });
  } catch (error) {
    await cloudinary.uploader.destroy(asset.public_id,{resource_type:'raw',type:'authenticated'}).catch(()=>{});
    if (error.code === 11000) return Delivery.findOne({snapshotKey});
    throw error;
  }
}
async function ensure(type, record) {
  const data = record.toObject ? record.toObject() : record;
  const key = fingerprint(type,data);
  if (!inFlight.has(key)) inFlight.set(key,createSnapshot(type,data,key).finally(()=>inFlight.delete(key)));
  return inFlight.get(key);
}
async function emailData(type, record) {
  const snapshot = await ensure(type,record);
  const data = record.toObject ? record.toObject() : record;
  return {...data,_pdfBuffer:await readPDF(snapshot),_snapshotId:snapshot._id};
}
module.exports = {ensure,readPDF,emailData,fingerprint};
