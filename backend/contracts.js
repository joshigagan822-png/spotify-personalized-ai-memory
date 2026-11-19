import { surfaces } from './catalog.js';
import { ensure } from './memory.js';

const str={type:'string',minLength:1,maxLength:600};
const id={type:'string',minLength:1,maxLength:100,pattern:'^[a-zA-Z0-9_.:-]+$'};
const integer={type:'integer',minimum:1};
const oneOf=(items)=>({type:'string',enum:items});
const object=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const arr=items=>({type:'array',items});
const context=object({memory_id:id,entity_id:id,normalized_fact:str,memory_type:str,predicate:str,confidence:{type:'number'},
  valid_from:str,expires_at:str,source_class:str,source_event_ids:arr(id),policy_id:id,seconds_played:{type:['integer','null']},
  relevance_reason:str,score:{type:'number'}});
export const toolDefinitions={
  search_memory:{description:'Search the current listener’s eligible memories.',limit:120,
    input:object({utterance:str,surface:oneOf(surfaces),locale:str,max_context_items:{...integer,maximum:3},context_token_budget:{...integer,maximum:512}}),
    output:object({trace_id:id,context:arr(context),fallback_reason:{type:['string','null']}})},
  add_explicit_preference:{description:'Remember an explicit choice from the catalog.',limit:30,
    input:object({entity_id:id,polarity:oneOf(['positive','negative']),surface:oneOf(surfaces),idempotency_key:id}),
    output:object({memory_id:id,graph_version:integer,policy_id:id,source_event_id:id,trace_id:id})},
  correct_memory:{description:'Replace an active preference at the given version.',limit:30,
    input:object({memory_id:id,replacement_entity_id:id,expected_graph_version:integer,idempotency_key:id}),
    output:object({memory_id:id,supersedes_memory_id:id,policy_id:id,source_event_id:id,trace_id:id})},
  delete_memory:{description:'Request erasure and return the propagation job.',limit:15,
    input:object({memory_id:id,idempotency_key:id}),output:object({job_id:id,status:oneOf(['pending','completed']),policy_id:id,trace_id:id})},
  explain_memory_use:{description:'Explain a memory used in one of this listener’s traces.',limit:60,
    input:object({memory_id:id,trace_id:id}),output:object({memory_id:id,relevance_reason:str,source_event_ids:arr(id),policy_id:id,confidence:{type:'number'}})}
};
export function validate(schema,value) {
  const t=value===null ? 'null':Array.isArray(value)?'array':typeof value;
  const types=[schema.type].flat();
  ensure(types.includes(t) || (Number.isInteger(value) && types.includes('integer')),'validation_error',422);
  if(value===null) return;
  if(t==='object') {
    ensure(schema.required.every(k=>Object.hasOwn(value,k)) && Object.keys(value).every(k=>Object.hasOwn(schema.properties,k)),'validation_error',422);
    for(const [k,v] of Object.entries(value)) validate(schema.properties[k],v);
  } else if(t==='array') { for(const item of value) validate(schema.items,item); }
  else if(t==='string') {
    ensure(value.trim().length>=(schema.minLength||0) && value.length<=(schema.maxLength||1000) &&
      (!schema.enum || schema.enum.includes(value)) && (!schema.pattern || new RegExp(schema.pattern).test(value)),'validation_error',422);
  } else if(t==='number') ensure(Number.isFinite(value) && value >= (schema.minimum??-Infinity) && value <= (schema.maximum??Infinity),'validation_error',422);
}
