// JSON.parse grammar plus duplicate-member rejection; no fences/coercion/repair.
export function parseStrictJSON(text){
  const result=JSON.parse(text);let i=0;
  const ws=()=>{while(/\s/.test(text[i]??'')&&i<text.length)i++;};
  function string(){const start=i++;while(text[i]!=='"'){if(text[i]==='\\')i++;i++;}i++;return JSON.parse(text.slice(start,i));}
  function value(){ws();if(text[i]==='"'){string();return;}
    if(text[i]==='{'){i++;ws();const keys=new Set();if(text[i]==='}'){i++;return;}while(true){ws();const key=string();if(keys.has(key))throw Error('duplicate_json_member');keys.add(key);ws();i++;value();ws();if(text[i]==='}'){i++;return;}i++;}}
    if(text[i]==='['){i++;ws();if(text[i]===']'){i++;return;}while(true){value();ws();if(text[i]===']'){i++;return;}i++;}}
    while(i<text.length&&!/[\s,}\]]/.test(text[i]))i++;
  }
  value();return result;
}
