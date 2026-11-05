const marker = "/* devhub-image-send-v1 */";
const silentFailure = /catch\((\w+)\)\{return console\.error\("\[attachments\] Failed to encode attachment for send",\{id:(\w+)\.id,error:\1\}\),null\}/g;

export function protectImageEncoding(bundle) {
  const matches = [...bundle.matchAll(silentFailure)];
  if (bundle.includes(marker)) {
    return bundle.split(marker).length === 2 && bundle.includes(`${marker}catch(`) && matches.length === 0 ? bundle : null;
  }
  if (matches.length !== 1) return null;
  return bundle.replace(silentFailure, (_, error, image) => `${marker}catch(${error}){console.error("[attachments] Failed to encode attachment for send",{id:${image}.id,error:${error}});throw new Error("An attached image could not be read. Remove it, then paste it again or use the attachment picker.")}`);
}
