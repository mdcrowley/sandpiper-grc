// The camera and photos (E38-05, E38-06). Owner: APP-CAMERA.
// - TagCamera.tsx: the live camera that reads codes (react-native-vision-camera-barcode-scanner, ML Kit
//   on the device) and printed text (react-native-vision-camera-ocr-plus, ML Kit on-device text
//   recognition with its model bundled; translation and other scripts switched off in app.json).
// - still.ts: the same reading on a still picture; geometry.ts: boxes from the picture to the screen.
// - photos.ts: photos fitted to the server's attachment limits and uploaded to a record.
// - reports.ts, reportQueue.ts: the report queue that survives lost connections; report/: the Report tab.
// Nothing here sends a picture anywhere except an upload the person asked for.
export { TagCamera, type TagCameraHandle } from './TagCamera';
export { readStill, discardPicture } from './still';
export { attachmentLimits, fitPhoto, uploadPhoto } from './photos';
export { reportQueue, useReportQueue } from './reportQueue';
