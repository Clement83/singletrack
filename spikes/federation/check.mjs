const g=async(u,o)=>{const r=await fetch(u,o);return [r.status,(await r.text()).slice(0,500)]};
console.log('webfinger', await g('http://localhost:3001/.well-known/webfinger?resource='+encodeURIComponent('acct:paul@localhost:3001'),{headers:{accept:'application/jrd+json'}}));
console.log('actor', await g('http://localhost:3001/ap/users/paul',{headers:{accept:'application/activity+json'}}));
console.log('send', await g('http://localhost:3000/api/send',{method:'POST',body:JSON.stringify({from:'alice',to:'http://localhost:3001/ap/users/paul'})}));
await new Promise(r=>setTimeout(r,9000));
console.log('log1', await g('http://localhost:3000/api/send'));
console.log('log2', await g('http://localhost:3001/api/send'));
