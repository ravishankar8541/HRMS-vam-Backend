const express = require('express');
const router = express.Router();
const {
  getAllDocuments,
  previewDocumentPDF,
  bulkDownload,
  deleteDocument,
  bulkDeleteDocuments,
} = require('../controllers/documentController');

router.get('/', getAllDocuments);
router.get('/edit/:type/:id', require('../middleware/auth').staffOnly, require('../controllers/documentController').getDocumentSource);
router.get('/source/:type/:id', require('../middleware/auth').staffOnly, require('../controllers/documentController').previewSource);
router.get('/preview/:type/:id', previewDocumentPDF);
router.post('/salary-slips/:id/send', require('../middleware/auth').staffOnly, require('../controllers/documentController').sendSalarySlip);
router.delete('/:type/:id', require('../middleware/auth').staffOnly, deleteDocument);
router.post('/bulk-delete', require('../middleware/auth').staffOnly, bulkDeleteDocuments);
router.post('/bulk-download', bulkDownload);

module.exports = router;
