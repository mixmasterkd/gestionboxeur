import { client } from './config.js';
import { mountNavigation } from './navigation.js';

const $ = id => document.getElementById(id);
const option=(label,value)=>{const item=document.createElement('option');item.textContent=label;item.value=value;return item;};
const today = new Date();
const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
let currentUser = null, athlete = null, gyms = [], generation = 0, role = null;
$('profileBirthDate').max = localDate;
function failure(error) {
  const unavailable = ['42P01','42703','PGRST205','PGRST202'].includes(error?.code);
  $('profileError').textContent = unavailable ? 'Le profil et le répertoire des gyms seront disponibles après l’activation de la mise à jour de la plateforme.' : error?.message || 'Impossible d’enregistrer. Réessaie.';
  $('profileError').classList.remove('hidden');
}
function clearMessages() { $('profileError').classList.add('hidden'); $('profileSuccess').classList.add('hidden'); }
async function result(query) { const {data,error} = await query; if(error) throw error; return data; }
function setBrand(gym) { $('gymBrand').textContent = gym?.name || 'Mon espace'; $('gymAddress').textContent = gym?.address || ''; }
function updateAge() {
  const value = $('profileBirthDate').value;
  if (!value || value > localDate) { $('profileAge').textContent = ''; return; }
  const [y,m,d] = value.split('-').map(Number);
  $('profileAge').textContent = `${today.getFullYear()-y-(today.getMonth()+1<m || (today.getMonth()+1===m && today.getDate()<d) ? 1 : 0)} ans`;
}
function fillAthlete(profile) {
  const values = {profileFirstName:athlete.first_name,profileLastName:athlete.last_name,profileBirthDate:athlete.birth_date,profileSex:athlete.sex,profilePhone:profile.phone,profileGym:athlete.gym_id,profileStatus:athlete.status||'available',profileWeightUnit:athlete.weight_unit||'kg',profileFights:athlete.fights??0,profileWins:athlete.wins,profileLosses:athlete.losses};
  Object.entries(values).forEach(([id,value])=>{$(id).value=value??'';});
  $('profileWeight').value=athlete.weight_kg==null?'':Math.round(Number(athlete.weight_kg)*($('profileWeightUnit').value==='lb'?2.2046226218:1)*10)/10;
  setBrand(gyms.find(g=>g.id===athlete.gym_id)); updateAge();
}
async function initialize() {
  const ticket = ++generation;
  clearMessages();
  try {
    const {session} = await result(client.auth.getSession());
    if(ticket!==generation)return;
    if(!session){location.replace('login.html');return;}
    currentUser=session.user;
    const profile=await result(client.from('profiles').select('id,full_name,phone,account_type,is_admin,gym_id').eq('id',currentUser.id).single());
    if(ticket!==generation)return;
    role=profile.account_type;
    mountNavigation({role,isAdmin:profile.is_admin});
    gyms=await result(client.from('gyms').select('id,name,address,is_default').order('name'));
    if(ticket!==generation)return;
    for(const id of ['profileGym','existingGym']) {
      $(id).replaceChildren(option(id==='profileGym'?'Sans gym pour le moment':'Ajouter mon gym',''));
      gyms.forEach(g=>$(id).append(option(`${g.name}${g.address?' · '+g.address:''}`,g.id)));
    }
    if(['athlete','coach'].includes(role)){
      athlete=await result(client.from('athletes').select('id,first_name,last_name,birth_date,sex,status,weight_kg,weight_unit,fights,wins,losses,gym_id').eq('user_id',currentUser.id).single());
      if(ticket!==generation)return;
      fillAthlete(profile); $('athletePanel').classList.remove('hidden');
    }else throw new Error('Le compte n’est pas reconnu.');
    $('enableCoachingButton').hidden = role==='coach' || currentUser.app_metadata?.is_test_athlete === true;
    if(role==='coach'){
      const gym=await result(client.from('gym_settings').select('gym_name,address').eq('coach_id',currentUser.id).maybeSingle());
      if(ticket!==generation)return;
      $('profileTitle').textContent='Mon profil'; document.title='Mon profil';
      $('coachGymName').value=gym?.gym_name||''; $('coachGymAddress').value=gym?.address||''; $('existingGym').value=profile.gym_id||'';
      setBrand({name:gym?.gym_name,address:gym?.address}); $('coachPanel').classList.remove('hidden');
    }
  }catch(error){if(ticket===generation)failure(error);}
  finally{if(ticket===generation)$('profileLoading').classList.add('hidden');}
}
$('enableCoachingButton').addEventListener('click',async()=>{
  if(!currentUser || $('enableCoachingButton').disabled)return;
  const ticket=generation; $('enableCoachingButton').disabled=true; clearMessages();
  try{ await result(client.rpc('enable_coaching',{})); if(ticket!==generation)return; await initialize(); }
  catch(error){if(ticket===generation)failure(error);}
  finally{$('enableCoachingButton').disabled=false;}
});
$('profileBirthDate').addEventListener('input',updateAge);
$('existingGym').addEventListener('change',()=>{const gym=gyms.find(g=>g.id===$('existingGym').value);$('coachGymName').value=gym?.name||'';$('coachGymAddress').value=gym?.address||'';});
$('profileWeightUnit').addEventListener('change',event=>{
  if($('profileWeight').value==='')return;
  const value=Number($('profileWeight').value)* (event.target.value==='lb'?2.2046226218:1/2.2046226218);
  $('profileWeight').value=String(Math.round(value*10)/10);
});
$('athleteProfileForm').addEventListener('submit',async event=>{
  event.preventDefault(); if(!currentUser||!athlete||$('saveProfileButton').disabled)return;
  const ticket=generation; $('saveProfileButton').disabled=true;clearMessages();
  try{
    const number=id=>$(id).value===''?null:Number($(id).value);
    const fights=number('profileFights')??0,wins=number('profileWins'),losses=number('profileLosses'),weight=number('profileWeight');
    if(!$('profileBirthDate').value||$('profileBirthDate').value>localDate)throw new Error('Une date de naissance valide est obligatoire.');
    if([fights,wins,losses].some(n=>n!==null&&(!Number.isSafeInteger(n)||n<0))||(wins??0)+(losses??0)>fights)throw new Error('Vérifie ton bilan : victoires et défaites ne peuvent pas dépasser le nombre de combats.');
    if(weight!==null&&(!Number.isFinite(weight)||weight<=0||weight>1500))throw new Error('Indique un poids valide.');
    await result(client.rpc('save_athlete_profile',{p_data:{first_name:$('profileFirstName').value.trim(),last_name:$('profileLastName').value.trim(),birth_date:$('profileBirthDate').value,sex:$('profileSex').value||null,status:$('profileStatus').value,phone:$('profilePhone').value.trim()||null,gym_id:$('profileGym').value||null,weight_kg:weight===null?null:$('profileWeightUnit').value==='lb'?Math.round(weight/2.2046226218*1000)/1000:weight,weight_unit:$('profileWeightUnit').value,fights,wins,losses}}));
    if(ticket!==generation)return;
    setBrand(gyms.find(g=>g.id===$('profileGym').value));$('profileSuccess').textContent='Ton profil est à jour. Tes coachs retrouveront ces informations dans leurs listes.';$('profileSuccess').classList.remove('hidden');
  }catch(error){if(ticket===generation)failure(error);}finally{if(ticket===generation)$('saveProfileButton').disabled=false;}
});
$('coachGymForm').addEventListener('submit',async event=>{
  event.preventDefault();if(!currentUser||role!=='coach'||$('saveGymButton').disabled)return;
  const ticket=generation;$('saveGymButton').disabled=true;clearMessages();
  try{
    await result(client.rpc('save_gym',{p_name:$('coachGymName').value.trim(),p_address:$('coachGymAddress').value.trim()}));
    if(ticket!==generation)return;
    setBrand({name:$('coachGymName').value.trim(),address:$('coachGymAddress').value.trim()});$('profileSuccess').textContent='Ton gym est enregistré et disponible pour les athlètes.';$('profileSuccess').classList.remove('hidden');
  }catch(error){if(ticket===generation)failure(error);}finally{if(ticket===generation)$('saveGymButton').disabled=false;}
});
$('logoutButton').addEventListener('click',async()=>{const {error}=await client.auth.signOut({scope:'local'});if(error)failure(error);});
client.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'){generation++;currentUser=null;athlete=null;role=null;document.querySelectorAll('form').forEach(form=>form.reset());$('athletePanel').classList.add('hidden');$('coachPanel').classList.add('hidden');location.replace('login.html');}});
initialize();
