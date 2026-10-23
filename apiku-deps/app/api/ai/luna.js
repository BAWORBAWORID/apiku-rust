/**
 * ChatbotApp Luna - gpt-5.6-luna via akunlama tmail auto session
 * Model enum free: gpt-5.6-luna, gpt-5-mini, gpt-5-nano, gpt-4o-mini, auto
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const SESSION_FILE = path.join(process.cwd(), 'data', 'luna.json')

const API_KEY = "AIzaSyBQLxwsoGGyo0DOI-P8IdRWDAE401me8E8"
const AKUNLAMA_DOMAIN = "akunlama.com"
const ADJECTIVES = ["happy","sleepy","clever","swift","brave","calm","wild","gentle","lucky","proud","cozy","fuzzy"]
const ANIMALS = ["kitten","cat","tiger","lion","panther","cheetah","lynx","puma","jaguar","leopard"]

function generateRandomName() {
  const adj = ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)]
  const animal = ANIMALS[Math.floor(Math.random()*ANIMALS.length)]
  const num = Math.floor(Math.random()*900)+100
  return `${adj}-${animal}-${num}-${Date.now().toString(36).slice(-4)}`
}
const sleep = ms => new Promise(r=>setTimeout(r,ms))
function loadSession(){
  try{ if(!fs.existsSync(SESSION_FILE)) return null; const d=JSON.parse(fs.readFileSync(SESSION_FILE,'utf8')); if(!d.email||!d.password) return null; return d }catch{ return null }
}
function saveSession(d){ fs.writeFileSync(SESSION_FILE, JSON.stringify(d,null,2)) }

async function signup(email,password){
  const r=await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/signupNewUser?key=${API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})})
  const j=await r.json(); if(!j.idToken) throw new Error(`Signup gagal: ${JSON.stringify(j).slice(0,500)}`); return j
}
async function login(email,password){
  const r=await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})})
  const j=await r.json(); if(!j.idToken) throw new Error(`Login gagal: ${JSON.stringify(j).slice(0,600)}`); return j
}
async function sendVerifyEmail(idToken){
  const r=await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getOobConfirmationCode?key=${API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestType:'VERIFY_EMAIL',idToken})})
  const j=await r.json(); if(j.error) throw new Error(`SendOob gagal: ${JSON.stringify(j)}`); return j
}
async function pollInbox(recipient,maxTries=12,intervalMs=5000){
  for(let i=0;i<maxTries;i++){ const r=await fetch(`https://akunlama.com/api/list?recipient=${encodeURIComponent(recipient)}`); const list=await r.json(); if(Array.isArray(list)&&list.length>0) return list; await sleep(intervalMs) }
  throw new Error('Inbox kosong')
}
async function getOobCode(recipient){
  const list=await pollInbox(recipient)
  const first=list[0]; const key=first.storage?.key; const region=first.storage?.region||'us'; if(!key) throw new Error('No key')
  const htmlRes=await fetch(`https://akunlama.com/api/getHtml?region=${encodeURIComponent(region)}&key=${encodeURIComponent(key)}`)
  const html=await htmlRes.text(); const m=html.match(/oobCode=([^&"'<>]+)/); if(!m) throw new Error('oobCode not found'); return decodeURIComponent(m[1])
}
async function verifyEmail(oobCode){
  const r=await fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/setAccountInfo?key=${API_KEY}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({oobCode})})
  const j=await r.json(); if(j.error) throw new Error(`Verify gagal: ${JSON.stringify(j)}`); return j
}
async function refreshIdToken(refreshToken){
  const r=await fetch(`https://securetoken.googleapis.com/v1/token?key=${API_KEY}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:`grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`})
  const j=await r.json(); if(!j.id_token) throw new Error(`Refresh gagal: ${JSON.stringify(j).slice(0,600)}`); return {idToken:j.id_token, refreshToken:j.refresh_token, localId:j.user_id}
}
async function getOrCreateSession(){
  let sess=loadSession()
  if(sess){
    try{
      if(sess.refreshToken){
        try{
          const refreshed=await refreshIdToken(sess.refreshToken)
          sess.idToken=refreshed.idToken; sess.refreshToken=refreshed.refreshToken; sess.localId=refreshed.localId
          saveSession(sess); return sess
        }catch{}
      }
      const loginJson=await login(sess.email,sess.password)
      sess.idToken=loginJson.idToken; sess.refreshToken=loginJson.refreshToken; sess.localId=loginJson.localId
      saveSession(sess); return sess
    }catch{}
  }
  const username=generateRandomName()
  const email=`${username}@${AKUNLAMA_DOMAIN}`
  const password=`Luna${Math.random().toString(36).slice(2,8)}!Aa1`
  const signupJson=await signup(email,password)
  await sendVerifyEmail(signupJson.idToken)
  const oobCode=await getOobCode(username)
  await verifyEmail(oobCode)
  const refreshed=await refreshIdToken(signupJson.refreshToken)
  await sleep(1500)
  const newSess={email,password,username,localId:refreshed.localId,idToken:refreshed.idToken,refreshToken:refreshed.refreshToken,createdAt:Date.now()}
  saveSession(newSess); return newSess
}
async function chat({idToken,localId,prompt,model}){
  const res=await fetch('https://api.chatbotapp.ai/api/chat',{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X_User_Id':localId,'X-User-Id':localId,
      'X_Token':idToken,'X-Token':idToken,
      'X_Platform':'web','X-Platform':'web',
      'Origin':'https://chat.chatbotapp.ai','Referer':'https://chat.chatbotapp.ai/'
    },
    body: JSON.stringify({messages:[{role:'user',content:prompt}], model, stream:false})
  })
  const text=await res.text()
  let json; try{ json=JSON.parse(text)}catch{ json={raw:text.slice(0,1000),status:res.status} }
  if(!res.ok) throw new Error(`Chat gagal HTTP ${res.status}: ${text.slice(0,800)}`)
  const content=json.choices?.[0]?.message?.content || json.content || text
  return {content, model: json.model || model, usage: json.usage, raw: json}
}

export default {
  name: "Luna - GPT-5.6 Luna",
  description: "Chat Luna gratis dengan auto session — support model gpt-5.6-luna, gpt-5-mini, gpt-5-nano, gpt-4o-mini, auto",
  category: "AI Chat",
  methods: ["GET","POST"],
  params: ["teks","model"],

  paramsSchema: {
    teks: {
      type: "string",
      required: true,
      description: "Prompt / pertanyaan",
      example: "halo siapa kamu?"
    },
    model: {
      type: "string",
      required: false,
      enum: ["gpt-5.6-luna","gpt-5-mini","gpt-5-nano","gpt-4o-mini","auto"],
      default: "gpt-5.6-luna",
      description: "Model gratis ChatbotApp"
    }
  },

  async run(req,res){
    const { teks, text, prompt, q, model = "gpt-5.6-luna" } = { ...req.query, ...req.body }
    const input = (teks || text || prompt || q || "").toString().trim()
    if (!input) return res.status(400).json({ status:false, message:"Parameter 'teks' wajib diisi" })

    const allowed = ["gpt-5.6-luna","gpt-5-mini","gpt-5-nano","gpt-4o-mini","auto"]
    const useModel = allowed.includes(model) ? model : "gpt-5.6-luna"

    try{
      let sess = await getOrCreateSession()
      try{
        const result = await chat({ idToken: sess.idToken, localId: sess.localId, prompt: input, model: useModel })
        return res.json({ status:true, model: useModel, result: result.content, usage: result.usage })
      }catch(chatErr){
        if(/1000|2002|credit/i.test(chatErr.message)){
          try{ fs.unlinkSync(SESSION_FILE) }catch{}
          sess = await getOrCreateSession()
          const result2 = await chat({ idToken: sess.idToken, localId: sess.localId, prompt: input, model: useModel })
          return res.json({ status:true, model: useModel, result: result2.content, usage: result2.usage })
        }
        throw chatErr
      }
    }catch(e){
      return res.status(500).json({ status:false, message: e.message || "Luna request failed" })
    }
  }
}
