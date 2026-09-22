// Fetch byte chunks concurrently, then decompress their original concatenated stream.
export async function unpack(url,onProgress,{fetcher=fetch,concurrency=4}={}) {
 const urls=Array.isArray(url)?url:[url],parts=new Array(urls.length);let next=0,loaded=0;
 const abort=new AbortController();
 async function worker(){while(next<urls.length){const i=next++,response=await fetcher(urls[i],{signal:abort.signal});if(!response.ok)throw new Error(`Could not load ${urls[i]}: ${response.status}`);
  const reader=response.body.getReader(),chunks=[];while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);loaded+=value.byteLength;onProgress?.(loaded);}parts[i]=new Blob(chunks);
 }}
 try{await Promise.all(Array.from({length:Math.min(concurrency,urls.length)},worker));return await new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();}
 catch(error){abort.abort();throw error;}
}
