(function(root){
  'use strict';
  function fillAuthorized(profile){
    // Self-contained: Chrome serializes this function; no remote code or closure data.
    const fail=code=>({ok:false,code});
    try{
      if(window.top!==window)return fail('FRAME_NOT_ALLOWED');
      if(location.origin!=='https://tviot.slika-ins.co.il')return fail('WRONG_ORIGIN');
      if(!/^\/start\/5\/?$/.test(location.pathname))return fail('WRONG_PAGE');
      if(!profile||Object.getPrototypeOf(profile)!==Object.prototype||Object.keys(profile).sort().join(',')!=='address,firstName,lastName,taxId')return fail('INVALID_PROFILE');
      for(const [key,max] of [['firstName',80],['lastName',80],['taxId',9],['address',300]])if(typeof profile[key]!=='string'||!profile[key].trim()||profile[key]!==profile[key].trim()||profile[key].length>max||/[<>\u0000-\u001f\u007f-\u009f]/.test(profile[key]))return fail('INVALID_PROFILE');
      if(!/^\d{9}$/.test(profile.taxId)||/^0+$/.test(profile.taxId)||[...profile.taxId].reduce((sum,d,i)=>{const n=Number(d)*(1+i%2);return sum+(n>9?n-9:n);},0)%10!==0)return fail('INVALID_PROFILE');
      const visible=node=>{
        if(!node.isConnected||node.hidden||!node.getClientRects().length)return false;
        for(let p=node;p&&p.nodeType===1;p=p.parentElement){const style=getComputedStyle(p);if(p.hidden||p.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||Number(style.opacity)===0)return false;}
        return true;
      };
      const modals=[...document.querySelectorAll('#modal3')];
      if(modals.length!==1)return fail('MODAL_NOT_FOUND');const modal=modals[0];if(!visible(modal))return fail('MODAL_NOT_VISIBLE');
      const fields=[
        ['firstName','ShemPrtiMorshe string','שם פרטי של המורשה'],
        ['lastName','ShemMishpachaMorshe string','שם משפחה של המורשה'],
        ['taxId','tzOfMorshe veNumber','תעודת זהות של המורשה'],
        ['address','KtovetMorshe string','כתובת של המורשה']
      ],targets=[];
      for(const [key,name,placeholder] of fields){
        const all=[...modal.querySelectorAll('input[name="'+name+'"]')];
        if(all.length!==1)return fail('FIELD_MISMATCH');const input=all[0];
        if(!(input instanceof HTMLInputElement)||input.getAttribute('placeholder')!==placeholder||!['text','number'].includes(input.type))return fail('FIELD_MISMATCH');
        if(!visible(input)||input.disabled||input.readOnly||input.matches(':disabled')||input.closest('[inert]'))return fail('FIELD_NOT_EDITABLE');
        if(input.value!==''&&input.value!==profile[key])return fail('CONFLICT');
        targets.push({input,value:profile[key],old:input.value});
      }
      const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;
      if(!setter)return fail('WRITE_FAILED');
      // Validate all targets before changing any value. No checkbox, click, focus or submit calls.
      let changed=0;
      const stillEditable=()=>visible(modal)&&targets.every(t=>modal.contains(t.input)&&visible(t.input)&&!t.input.disabled&&!t.input.readOnly&&!t.input.matches(':disabled')&&!t.input.closest('[inert]'));
      for(const target of targets){
        if(!stillEditable()||(target.input.value!==target.old&&target.input.value!==target.value))return fail('WRITE_FAILED');
        if(target.old===target.value)continue;
        setter.call(target.input,target.value);target.input.dispatchEvent(new Event('input',{bubbles:true}));target.input.dispatchEvent(new Event('change',{bubbles:true}));changed++;
      }
      if(!stillEditable()||targets.some(t=>t.input.value!==t.value))return fail('WRITE_FAILED');
      return {ok:true,filled:4,changed};
    }catch{return fail('WRITE_FAILED');}
  }
  root.NewCarFillAuthorized=fillAuthorized;
  if(typeof module==='object'&&module.exports)module.exports=fillAuthorized;
})(globalThis);
