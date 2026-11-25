import { getAssetForUser } from "./service.js";
import { getR2Object } from "./r2.js";
import { badRequest } from "../lib/errors.js";
const allowed=new Set(["application/pdf","image/png","image/jpeg","image/webp","application/vnd.openxmlformats-officedocument.wordprocessingml.document","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.openxmlformats-officedocument.presentationml.presentation","text/plain","text/csv"]);
export const communityFileLimit=10*1024*1024;
export async function communityFileMetadata(userId:string,assetId:string){
 const asset=await getAssetForUser(userId,assetId);
 const size=Number(asset.sizeBytes);
 if(!allowed.has(asset.mimeType)||!Number.isSafeInteger(size)||size<1||size>communityFileLimit)throw badRequest("Unsupported event file type or size");
 const filename=(asset.filename||"document").replace(/[\u0000-\u001f\u007f/\\]/g,"_").slice(0,180);
 return {asset,metadata:{assetId:asset.id,filename,mimeType:asset.mimeType,sizeBytes:size}};
}
export async function exportCommunityFile(userId:string,assetId:string){
 const {asset,metadata}=await communityFileMetadata(userId,assetId);
 const object=await getR2Object(asset.r2Key);
 if(object.content.byteLength!==metadata.sizeBytes||object.content.byteLength>communityFileLimit)throw badRequest("File contents changed");
 return {metadata,bytes:object.content};
}
