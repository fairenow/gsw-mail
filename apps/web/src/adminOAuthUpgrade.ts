const authorizationParameters = new Set(["client_id","redirect_uri","response_type","response_mode","state","code_challenge","code_challenge_method","resource","nonce","login_hint","max_age","claims","acr_values"]);
export function adminOAuthUpgradeUrl(search:string,allowedScopes:readonly string[]):string {
  const original=new URLSearchParams(search);
  for(const key of ["client_id","redirect_uri","response_type","code_challenge","code_challenge_method"]) {
    if(original.getAll(key).length!==1 || !original.get(key)) throw new Error("Start a fresh connection to review administration permissions.");
  }
  if(original.get("response_type")!=="code" || original.get("code_challenge_method")!=="S256") throw new Error("A secure authorization-code request is required.");
  const next=new URLSearchParams();
  for(const [key,value] of original) if(authorizationParameters.has(key)) next.append(key,value);
  next.set("scope",[...new Set(allowedScopes)].join(" "));
  next.set("prompt","consent");
  return `/api/auth/oauth2/authorize?${next}`;
}
