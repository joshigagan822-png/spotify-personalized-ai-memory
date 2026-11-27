export function createSpotifySearch(clientId, secret, fetcher = fetch) {
  let token, expires = 0, pending, retryAt = 0;
  async function request(url, options) {
    const response = await fetcher(url,{...options,signal:AbortSignal.timeout(3500)});
    if (response.status === 429) retryAt = Date.now() + 1000 * (Number(response.headers.get('retry-after')) || 30);
    if (!response.ok) {
      if(response.status === 401) expires = 0;
      throw Error('Spotify unavailable');
    }
    return response.json();
  }
  async function authorize() {
    const result = await request('https://accounts.spotify.com/api/token',{
      method:'POST',headers:{Authorization:'Basic '+Buffer.from(clientId+':'+secret).toString('base64'),
        'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});
    if (!result.access_token) throw Error('Invalid token');
    token = result.access_token;
    expires = Date.now() + (result.expires_in - 30) * 1000;
  }
  return async function search(term,type='track') {
    if (!clientId || !secret || Date.now() < retryAt) return {available:false,tracks:[]};
    try {
      if (Date.now() >= expires || !token) {
        pending ||= authorize().finally(()=>{pending=null;});
        await pending;
      }
      const params = new URLSearchParams({q:term,type,market:'IN',limit:'10'});
      const data = await request('https://api.spotify.com/v1/search?'+params,{headers:{Authorization:'Bearer '+token}});
      const tracks = data[type+'s'].items.filter(t=>t && /^[A-Za-z0-9]{22}$/.test(t.id)).map(t=>({
        id:t.id,type,title:t.name,artist:t.artists?.map(a=>a.name).join(', ') || t.owner?.display_name || t.show?.name || '',image:t.album?.images?.[0]?.url || t.images?.[0]?.url || ''}));
      return {available:true,tracks};
    } catch {return {available:false,tracks:[]};}
  };
}
