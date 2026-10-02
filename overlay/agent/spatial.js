/** Spatial observations only; no executor and no Rules decision enters this module.
 * Constants match the pinned engine's micropolis.h/tool.h. Distances use Manhattan
 * distance from the complete footprint; supply means connection to a plant,
 * not stale PWRBIT flags and not merely an isolated conductive tile.
 */
/** @typedef {{actionId:string, legal:boolean, roadDistance:number|null, powerDistance:number|null, zoneDistance:number|null, roadCount:number, plantCount:number}} CandidateFeatures */
const TOOLS = {res:[3,100],com:[3,100],ind:[3,100],road:[1,10],wire:[1,5],coal:[4,3000],police:[3,500],fire:[3,500]};
/** @param {string|null} id */
export function intentOf(id) {
  if (!id) return null;
  const parts=id.split(':');
  return parts[0]==='build' ? `build:${parts[1]}` : parts[0];
}
/** @param {(x:number,y:number)=>number} readTile @param {number} width @param {number} height
 * @param {import('./agents.js').Candidate[]} candidates @param {number} funds
 * @returns {CandidateFeatures[]} */
export function candidateFeatures(readTile,width,height,candidates,funds) {
  const tiles=new Uint16Array(width*height);
  /** @type {number[]} */ const roads=[],plants=[],zones=[];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,raw=Number(readTile(x,y));tiles[i]=raw;const tile=raw&1023;
    if(tile>=64&&tile<=206)roads.push(i);
    if((tile>=745&&tile<=760)||(tile>=811&&tile<=826))plants.push(i);
    if((raw&1024)&&tile>=240&&tile<=692)zones.push(i);
  }
  /** @param {number} i */
  const adjacent=(i)=>[i%width>0?i-1:-1,i%width<width-1?i+1:-1,i>=width?i-width:-1,i<width*(height-1)?i+width:-1].filter(j=>j>=0);
  const powered=new Uint8Array(tiles.length);const supply=[...plants];
  for(const i of supply)powered[i]=1;
  for(let q=0;q<supply.length;q++)for(const j of adjacent(supply[q]))if(!powered[j]&&(tiles[j]&16384)){powered[j]=1;supply.push(j);}
  /** @param {number[]} seeds */
  function distances(seeds){
    const d=new Int16Array(tiles.length);d.fill(-1);const queue=[...seeds];
    for(const i of queue)d[i]=0;
    for(let q=0;q<queue.length;q++)for(const j of adjacent(queue[q]))if(d[j]<0){d[j]=d[queue[q]]+1;queue.push(j);}
    return d;
  }
  const roadD=distances(roads),powerD=distances(supply),zoneD=distances(zones);
  return candidates.map(({id,action})=>{
    const base={actionId:id,legal:true,roadDistance:/** @type {number|null} */(null),powerDistance:/** @type {number|null} */(null),zoneDistance:/** @type {number|null} */(null),roadCount:roads.length,plantCount:plants.length};
    if(action.kind!=='build')return {...base,legal:action.kind==='wait'||(action.kind==='tax'&&typeof action.value==='number'&&Number.isInteger(action.value)&&action.value>=0&&action.value<=20)};
    const tool=TOOLS[/** @type {keyof typeof TOOLS} */(action.tool)];
    if(!tool||typeof action.x!=='number'||typeof action.y!=='number'||!Number.isInteger(action.x)||!Number.isInteger(action.y))return {...base,legal:false};
    const [size,cost]=tool,offset=size>1?1:0,x0=action.x-offset,y0=action.y-offset;
    if(x0<0||y0<0||x0+size>width||y0+size>height)return {...base,legal:false};
    /** @type {number[]} */ const footprint=[];for(let y=y0;y<y0+size;y++)for(let x=x0;x<x0+size;x++)footprint.push(y*width+x);
    /** @param {Int16Array} field */ const distance=field=>{const values=footprint.map(i=>field[i]).filter(v=>v>=0);return values.length?Math.min(...values):null;};
    return {...base,legal:funds>=cost&&footprint.every(i=>(tiles[i]&1023)===0),roadDistance:distance(roadD),powerDistance:distance(powerD),zoneDistance:distance(zoneD)};
  });
}
/** Versioned plausibility-v1: physical prerequisites, not an optimal-policy score.
 * Tax/wait are spatially neutral and satisfy spatial constraints when legal;
 * report build-only rate and neutral count separately to expose this limitation.
 * @param {string|null} id @param {CandidateFeatures[]} features */
export function classifySpatial(id,features){
  const f=features.find(item=>item.actionId===id);
  if(!f||!f.legal)return {spatiallyPlausible:false,spatialReason:'missing_or_illegal',spatialNeutral:false};
  const tool=id?.split(':')[1];let plausible=false;
  const close=(/** @type {number|null} */ d,/** @type {number} */ max)=>d!==null&&d<=max;
  if(id==='wait'||id?.startsWith('tax:'))return {spatiallyPlausible:true,spatialReason:'no_placement_constraint',spatialNeutral:true};
  if(['res','com','ind'].includes(tool??''))plausible=close(f.roadDistance,1)&&close(f.powerDistance,3);
  else if(tool==='wire')plausible=close(f.powerDistance,1);
  else if(tool==='road')plausible=close(f.roadDistance,1)||(f.roadCount===0&&close(f.powerDistance,8));
  else if(tool==='coal')plausible=f.plantCount===0||close(f.zoneDistance,8);
  else if(tool==='police'||tool==='fire')plausible=close(f.roadDistance,1)&&close(f.zoneDistance,6);
  return {spatiallyPlausible:plausible,spatialReason:plausible?'physical_prerequisites':'disconnected_or_remote',spatialNeutral:false};
}
