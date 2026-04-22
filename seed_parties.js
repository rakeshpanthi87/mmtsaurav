require('dotenv').config();
const { db } = require('./database/db');

// 10 leaders per major political party of Nepal
// INSERT OR IGNORE — safe to run, skips already-existing entries

const parties = [

  // ── 1. NEPALI CONGRESS (NC) ───────────────────────────────────────
  { name:'Shekhar Koirala',         local:'शेखर कोइराला',          party:'Nepali Congress',          gender:'M', age:63, bio:'President of Nepali Congress and nephew of BP Koirala. Senior party leader and former deputy PM.' },
  { name:'Prakash Man Singh',       local:'प्रकाश मान सिंह',       party:'Nepali Congress',          gender:'M', age:67, bio:'Vice-President of Nepali Congress and former Home and Finance Minister.' },
  { name:'Bishwa Prakash Sharma',   local:'विश्व प्रकाश शर्मा',    party:'Nepali Congress',          gender:'M', age:55, bio:'Senior NC leader and former Home Minister known for anti-corruption stance.' },
  { name:'Minendra Rijal',          local:'मिनेन्द्र रिजाल',       party:'Nepali Congress',          gender:'M', age:58, bio:'Nepali Congress Central Working Committee member and prominent party spokesperson.' },
  { name:'Sujata Koirala',          local:'सुजाता कोइराला',        party:'Nepali Congress',          gender:'F', age:62, bio:'Daughter of former PM Girija Prasad Koirala and senior NC leader and former Foreign Minister.' },
  { name:'Arjun Narasingha KC',     local:'अर्जुन नरसिंह के.सी.', party:'Nepali Congress',          gender:'M', age:65, bio:'Senior Nepali Congress leader and multiple-term parliamentarian from western Nepal.' },
  { name:'Bimala Rai Paudyal',      local:'बिमला राई पौड्याल',     party:'Nepali Congress',          gender:'F', age:55, bio:'Speaker of the House of Representatives and prominent NC leader from eastern Nepal.' },

  // ── 2. CPN-UML ────────────────────────────────────────────────────
  { name:'Pradeep Gyawali',         local:'प्रदीप ज्ञवाली',        party:'CPN-UML',                  gender:'M', age:59, bio:'Senior UML leader and former Foreign Minister known for his oratory and foreign policy expertise.' },
  { name:'Subas Chandra Nembang',   local:'सुवास चन्द्र नेम्वाङ',  party:'CPN-UML',                  gender:'M', age:68, bio:'Former Speaker of Nepal\'s Constituent Assembly and senior UML leader from eastern Nepal.' },
  { name:'Shankar Pokhrel',         local:'शंकर पोखरेल',           party:'CPN-UML',                  gender:'M', age:56, bio:'General Secretary of CPN-UML and one of the party\'s most influential organisers.' },
  { name:'Bhim Rawal',              local:'भीम रावल',               party:'CPN-UML',                  gender:'M', age:66, bio:'Senior UML leader and former Finance Minister, known for leftist economic positions.' },
  { name:'Yubaraj Khatiwada',       local:'युवराज खतिवडा',         party:'CPN-UML',                  gender:'M', age:64, bio:'Economist and former Finance Minister of Nepal, former Governor of Nepal Rastra Bank.' },
  { name:'Raghuji Pant',            local:'रघुजी पन्त',             party:'CPN-UML',                  gender:'M', age:60, bio:'Senior UML leader and former minister who has held multiple cabinet positions.' },
  { name:'Ishwar Pokhrel',          local:'ईश्वर पोखरेल',          party:'CPN-UML',                  gender:'M', age:69, bio:'Senior UML leader and former Defence Minister who played key roles in the peace process.' },
  { name:'Astha Laxmi Shakya',      local:'आस्था लक्ष्मी शाक्य',   party:'CPN-UML',                  gender:'F', age:52, bio:'UML\'s prominent female leader and Kathmandu-based parliamentarian.' },

  // ── 3. CPN (MAOIST CENTRE) ───────────────────────────────────────
  { name:'Agni Sapkota',            local:'अग्नि सापकोटा',         party:'CPN (Maoist Centre)',       gender:'M', age:58, bio:'Former Speaker of the House and senior Maoist leader from the People\'s War era.' },
  { name:'Pampha Bhusal',           local:'पम्फा भुसाल',           party:'CPN (Maoist Centre)',       gender:'F', age:57, bio:'Senior Maoist leader and former minister known for women\'s rights advocacy.' },
  { name:'Narayan Kaji Shrestha',   local:'नारायण काजी श्रेष्ठ',  party:'CPN (Maoist Centre)',       gender:'M', age:61, bio:'Secretary of CPN (Maoist Centre) and former Deputy Prime Minister, alias "Santu".' },
  { name:'Barsha Man Pun',          local:'वर्षमान पुन',            party:'CPN (Maoist Centre)',       gender:'M', age:56, bio:'Senior Maoist leader and former Defence Minister, known by alias "Ananta".' },
  { name:'Janardan Sharma',         local:'जनार्दन शर्मा',          party:'CPN (Maoist Centre)',       gender:'M', age:55, bio:'Former Finance Minister and senior Maoist leader, known as "Prabhakar".' },
  { name:'Ram Bahadur Thapa',       local:'रामबहादुर थापा',         party:'CPN (Maoist Centre)',       gender:'M', age:63, bio:'Senior Maoist leader and former Home Minister, known as "Badal", a commander in the People\'s War.' },
  { name:'Dev Gurung',              local:'देव गुरुङ',              party:'CPN (Maoist Centre)',       gender:'M', age:54, bio:'Senior CPN (Maoist Centre) leader and member of Central Committee.' },
  { name:'Dinanath Sharma',         local:'दिनानाथ शर्मा',          party:'CPN (Maoist Centre)',       gender:'M', age:56, bio:'Central Committee member of CPN (Maoist Centre) and outspoken political figure.' },
  { name:'Renu Dahal',              local:'रेनु दाहाल',             party:'CPN (Maoist Centre)',       gender:'F', age:48, bio:'Member of Parliament and daughter of party chair Pushpa Kamal Dahal (Prachanda).' },

  // ── 4. RASTRIYA SWATANTRA PARTY (RSP) ────────────────────────────
  { name:'Swarnim Wagle',           local:'स्वर्णिम वाग्ले',        party:'Rastriya Swatantra Party', gender:'M', age:46, bio:'Economist and RSP leader, former NPC Vice-Chairman known for liberal economic policies.' },
  { name:'Dol Prasad Aryal',        local:'दोल प्रसाद आर्याल',     party:'Rastriya Swatantra Party', gender:'M', age:44, bio:'RSP Central Committee member and youth organiser helping build the party\'s grassroots presence.' },
  { name:'Santosh Pariyar',         local:'सन्तोष परियार',          party:'Rastriya Swatantra Party', gender:'M', age:38, bio:'RSP leader representing Dalit communities and advocate for social justice.' },
  { name:'Milan Mani Pokhrel',      local:'मिलन मणि पोखरेल',       party:'Rastriya Swatantra Party', gender:'M', age:42, bio:'RSP parliamentarian and former civil society activist working on governance reforms.' },
  { name:'Dhana Kumari Sunar Pun',  local:'धना कुमारी सुनार पुन',  party:'Rastriya Swatantra Party', gender:'F', age:40, bio:'RSP\'s prominent female leader advocating for marginalised communities in parliament.' },
  { name:'Surya Man Dong',          local:'सूर्य मान डोङ',          party:'Rastriya Swatantra Party', gender:'M', age:45, bio:'RSP leader from far-west Nepal working on regional development and federalism issues.' },
  { name:'Rishikesh Pokhrel',       local:'ऋषिकेश पोखरेल',         party:'Rastriya Swatantra Party', gender:'M', age:40, bio:'RSP Central Committee member and legal expert contributing to policy development.' },
  { name:'Prateek Jwala',           local:'प्रतीक ज्वाला',          party:'Rastriya Swatantra Party', gender:'M', age:36, bio:'Young RSP leader and digital campaigner who helped the party attract youth voters.' },
  { name:'Shambhu Thapa',           local:'शम्भु थापा',             party:'Rastriya Swatantra Party', gender:'M', age:43, bio:'RSP parliamentarian focused on anti-corruption legislation and electoral reforms.' },

  // ── 5. CPN (UNIFIED SOCIALIST) ───────────────────────────────────
  { name:'Madhav Kumar Nepal',      local:'माधव कुमार नेपाल',      party:'CPN (Unified Socialist)',   gender:'M', age:72, bio:'Chair of CPN (Unified Socialist) and former Prime Minister. Split from UML to form this party in 2021.' },
  { name:'Jhalanath Khanal',        local:'झलनाथ खनाल',            party:'CPN (Unified Socialist)',   gender:'M', age:75, bio:'Former Prime Minister and senior CPN (Unified Socialist) leader.' },
  { name:'Surendra Pandey',         local:'सुरेन्द्र पाण्डे',      party:'CPN (Unified Socialist)',   gender:'M', age:64, bio:'Former Finance Minister and senior CPN-US leader known for development economics.' },
  { name:'Ghanashyam Bhusal',       local:'घनश्याम भुसाल',          party:'CPN (Unified Socialist)',   gender:'M', age:58, bio:'CPN (Unified Socialist) General Secretary and prominent left-wing economist.' },
  { name:'Ram Kumari Jhankri',      local:'राम कुमारी झाँक्री',    party:'CPN (Unified Socialist)',   gender:'F', age:55, bio:'Senior CPN-US leader and former minister known for rural development work.' },
  { name:'Deepak Bahadur Singh',    local:'दीपक बहादुर सिंह',      party:'CPN (Unified Socialist)',   gender:'M', age:60, bio:'CPN (Unified Socialist) Central Committee member and parliamentarian from Province 1.' },
  { name:'Birodh Khatiwada',        local:'विरोध खतिवडा',           party:'CPN (Unified Socialist)',   gender:'M', age:52, bio:'CPN-US leader and outspoken critic of KP Oli\'s leadership within the communist movement.' },
  { name:'Rakam Chemjong',          local:'रकम चेमजोङ',             party:'CPN (Unified Socialist)',   gender:'M', age:54, bio:'CPN (Unified Socialist) parliamentarian from eastern Nepal representing indigenous communities.' },
  { name:'Bharat Prasad Oli',       local:'भरत प्रसाद ओली',        party:'CPN (Unified Socialist)',   gender:'M', age:57, bio:'CPN-US senior leader and former minister, no relation to KP Sharma Oli of UML.' },
  { name:'Lila Koirala',            local:'लीला कोइराला',           party:'CPN (Unified Socialist)',   gender:'F', age:53, bio:'Senior female leader of CPN (Unified Socialist) and advocate for women in politics.' },

  // ── 6. RASTRIYA PRAJATANTRA PARTY (RPP) ──────────────────────────
  { name:'Rajendra Lingden',        local:'राजेन्द्र लिङ्देन',     party:'Rastriya Prajatantra Party', gender:'M', age:52, bio:'Chair of Rastriya Prajatantra Party and proponent of constitutional monarchy restoration.' },
  { name:'Kamal Thapa',             local:'कमल थापा',               party:'Rastriya Prajatantra Party', gender:'M', age:65, bio:'Former Deputy Prime Minister and former RPP chair, leading voice for Hindu state restoration.' },
  { name:'Pashupati Shumsher JBR',  local:'पशुपति शम्शेर जबरा',   party:'Rastriya Prajatantra Party', gender:'M', age:72, bio:'Former minister and scion of the Rana dynasty, senior RPP leader from Kathmandu.' },
  { name:'Budhi Man Tamang',        local:'बुद्धि मान तामाङ',      party:'Rastriya Prajatantra Party', gender:'M', age:55, bio:'RPP Central Committee member working to broaden the party\'s appeal among Janajati communities.' },
  { name:'Gopal Kiranti',           local:'गोपाल किराँती',          party:'Rastriya Prajatantra Party', gender:'M', age:58, bio:'RPP parliamentarian and activist representing ethnic communities\' cultural rights.' },
  { name:'Mahendra Bahadur Shahi',  local:'महेन्द्र बहादुर शाही',  party:'Rastriya Prajatantra Party', gender:'M', age:60, bio:'Senior RPP leader from far-western Nepal and advocate for monarchy and Hindu identity.' },
  { name:'Mohan Shrestha',          local:'मोहन श्रेष्ठ',           party:'Rastriya Prajatantra Party', gender:'M', age:57, bio:'RPP leader and former member of parliament focused on Kathmandu Valley issues.' },
  { name:'Umesh Shrestha',          local:'उमेश श्रेष्ठ',           party:'Rastriya Prajatantra Party', gender:'M', age:53, bio:'RPP Central Working Committee member and organiser in the Bagmati province.' },
  { name:'Rajeev Parajuli',         local:'राजीव पराजुली',          party:'Rastriya Prajatantra Party', gender:'M', age:48, bio:'RPP youth leader and digital organiser driving the party\'s outreach to younger voters.' },
  { name:'Dil Bahadur Gharti',      local:'दिल बहादुर घर्ती',      party:'Rastriya Prajatantra Party', gender:'M', age:56, bio:'RPP parliamentarian from Karnali province advocating for federalism reforms.' },

  // ── 7. JANAJATI SAMAJWADI PARTY (JSP) ────────────────────────────
  { name:'Upendra Yadav',           local:'उपेन्द्र यादव',          party:'Janajati Samajwadi Party', gender:'M', age:60, bio:'Chair of Janajati Samajwadi Party and leading voice for Madhesi and Janajati communities.' },
  { name:'Ashok Rai',               local:'अशोक राई',               party:'Janajati Samajwadi Party', gender:'M', age:58, bio:'Senior JSP leader and former minister representing eastern hill communities.' },
  { name:'Prem Suwal',              local:'प्रेम सुवाल',            party:'Janajati Samajwadi Party', gender:'M', age:55, bio:'JSP parliamentarian and activist for indigenous Newar community rights.' },
  { name:'Laxmi Yadav',             local:'लक्ष्मी यादव',           party:'Janajati Samajwadi Party', gender:'F', age:48, bio:'JSP female leader working on Madhesi women\'s representation and rights.' },
  { name:'Manish Suman',            local:'मनिष सुमन',              party:'Janajati Samajwadi Party', gender:'M', age:45, bio:'JSP Central Committee member and youth leader from the Terai region.' },
  { name:'Mahendra Raya Yadav',     local:'महेन्द्र राया यादव',    party:'Janajati Samajwadi Party', gender:'M', age:57, bio:'Veteran JSP leader and multiple-term parliamentarian from Madhesh province.' },
  { name:'Ram Naresh Raya Yadav',   local:'राम नरेश राया यादव',    party:'Janajati Samajwadi Party', gender:'M', age:63, bio:'Senior JSP leader and former minister with decades of Madhesi political activism.' },
  { name:'Anita Devi Yadav',        local:'अनिता देवी यादव',       party:'Janajati Samajwadi Party', gender:'F', age:44, bio:'JSP parliamentarian championing women\'s empowerment in the Terai plains.' },
  { name:'Sanjay Yadav',            local:'सञ्जय यादव',             party:'Janajati Samajwadi Party', gender:'M', age:42, bio:'JSP youth wing leader and organiser building the party\'s base among young Madhesi voters.' },
  { name:'Rajan Shrestha',          local:'राजन श्रेष्ठ',           party:'Janajati Samajwadi Party', gender:'M', age:50, bio:'JSP leader representing Newar and hill communities within the party\'s diverse coalition.' },

  // ── 8. LOKTANTRIK SAMAJWADI PARTY (LSP) ──────────────────────────
  { name:'Rajendra Mahato',         local:'राजेन्द्र महतो',         party:'Loktantrik Samajwadi Party', gender:'M', age:57, bio:'Chair of Loktantrik Samajwadi Party and longest-serving Madhesi political leader.' },
  { name:'Amresh Kumar Singh',      local:'अमरेश कुमार सिंह',       party:'Loktantrik Samajwadi Party', gender:'M', age:61, bio:'Senior LSP leader and veteran Madhesi parliamentarian from Saptari district.' },
  { name:'Hridayesh Tripathi',      local:'हृदयेश त्रिपाठी',        party:'Loktantrik Samajwadi Party', gender:'M', age:65, bio:'Former Deputy Prime Minister and senior LSP leader with deep roots in Madhesi politics.' },
  { name:'Brijesh Kumar Gupta',     local:'बृजेश कुमार गुप्ता',    party:'Loktantrik Samajwadi Party', gender:'M', age:55, bio:'LSP parliamentarian and businessman from Sarlahi known for development-focused politics.' },
  { name:'Anil Kumar Jha',          local:'अनिल कुमार झा',          party:'Loktantrik Samajwadi Party', gender:'M', age:52, bio:'LSP leader from Mahottari district working on Madhesh province governance.' },
  { name:'Ram Sahay Prasad Yadav',  local:'राम सहाय प्रसाद यादव',  party:'Loktantrik Samajwadi Party', gender:'M', age:66, bio:'Former President of Nepal and senior LSP leader from Siraha district.' },
  { name:'Laxman Lal Karna',        local:'लक्ष्मण लाल कर्ण',      party:'Loktantrik Samajwadi Party', gender:'M', age:58, bio:'LSP leader and parliamentarian representing Dhanusha, known for rural development advocacy.' },
  { name:'Birendra Prasad Mahato',  local:'विरेन्द्र प्रसाद महतो', party:'Loktantrik Samajwadi Party', gender:'M', age:54, bio:'LSP Central Committee member and organiser working on Madhesi identity politics.' },
  { name:'Prabhu Narayan Chaudhary',local:'प्रभु नारायण चौधरी',    party:'Loktantrik Samajwadi Party', gender:'M', age:56, bio:'LSP leader from Tharu community advocating for Tharu cultural and political rights.' },
  { name:'Abdul Khan',              local:'अब्दुल खान',             party:'Loktantrik Samajwadi Party', gender:'M', age:50, bio:'LSP parliamentarian representing Muslim community in the Terai and advocate for minority rights.' },

  // ── 9. RASTRIYA JANMUKTI PARTY (RJP) ─────────────────────────────
  { name:'Baburam Bhattarai',       local:'बाबुराम भट्टराई',        party:'Rastriya Janmukti Party',  gender:'M', age:72, bio:'Chair of Rastriya Janmukti Party, former Prime Minister, and ideologue of Nepal\'s left movement.' },
  { name:'Lilamani Pokhrel',        local:'लीलामणि पोखरेल',        party:'Rastriya Janmukti Party',  gender:'M', age:55, bio:'RJP General Secretary and close associate of Baburam Bhattarai in building the new party.' },
  { name:'Hisila Yami',             local:'हिसिला यमी',             party:'Rastriya Janmukti Party',  gender:'F', age:64, bio:'Former minister and urban planning expert, spouse of Baburam Bhattarai and senior RJP leader.' },
  { name:'Dina Nath Sharma',        local:'दिना नाथ शर्मा',         party:'Rastriya Janmukti Party',  gender:'M', age:52, bio:'RJP Central Committee member and youth organiser from Madhesh province.' },
  { name:'Hari Roka',               local:'हरि रोका',               party:'Rastriya Janmukti Party',  gender:'M', age:60, bio:'RJP senior leader, academic, and political economist advocating for federal restructuring.' },
  { name:'Nitu Phuyal',             local:'नितु फुयाल',             party:'Rastriya Janmukti Party',  gender:'F', age:42, bio:'RJP young female leader focused on women\'s political participation and social justice.' },
  { name:'Keshav Sthapit',          local:'केशव स्थापित',           party:'Rastriya Janmukti Party',  gender:'M', age:56, bio:'RJP leader and former KMC councillor known for urban governance and anti-corruption work.' },
  { name:'Amrit Bohara',            local:'अमृत बोहरा',             party:'Rastriya Janmukti Party',  gender:'M', age:48, bio:'RJP parliamentarian from Province 1 working on indigenous rights and environmental issues.' },
  { name:'Suresh Ale Magar',        local:'सुरेश आले मगर',         party:'Rastriya Janmukti Party',  gender:'M', age:46, bio:'RJP leader representing Janajati communities and advocate for inclusive federalism.' },
  { name:'Tika Ram Pokhrel',        local:'टीका राम पोखरेल',        party:'Rastriya Janmukti Party',  gender:'M', age:52, bio:'RJP Central Committee member and outspoken critic of the current political establishment.' },
];

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function initials(name) {
  const parts = name.split(' ').filter(Boolean);
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}

// Party colour coding
const partyColor = {
  'Nepali Congress':              { bg:'#1D4ED8', fg:'#FFFFFF' },
  'CPN-UML':                      { bg:'#DC2626', fg:'#FFFFFF' },
  'CPN (Maoist Centre)':          { bg:'#B91C1C', fg:'#FFFFFF' },
  'Rastriya Swatantra Party':     { bg:'#7C3AED', fg:'#FFFFFF' },
  'CPN (Unified Socialist)':      { bg:'#C2410C', fg:'#FFFFFF' },
  'Rastriya Prajatantra Party':   { bg:'#B45309', fg:'#FFFFFF' },
  'Janajati Samajwadi Party':     { bg:'#047857', fg:'#FFFFFF' },
  'Loktantrik Samajwadi Party':   { bg:'#0369A1', fg:'#FFFFFF' },
  'Rastriya Janmukti Party':      { bg:'#4F46E5', fg:'#FFFFFF' },
};

const ins = db.prepare(`
  INSERT OR IGNORE INTO personalities
    (slug, name, name_local, category, nationality, bio, initials, avatar_bg, avatar_fg, verified, gender, age)
  VALUES (?, ?, ?, 'politician', 'Nepali', ?, ?, ?, ?, 1, ?, ?)
`);

let added = 0;
for (const p of parties) {
  const c = partyColor[p.party] || { bg:'#374151', fg:'#FFFFFF' };
  const bioWithParty = `[${p.party}] ${p.bio}`;
  const r = ins.run(slug(p.name), p.name, p.local, bioWithParty, initials(p.name), c.bg, c.fg, p.gender, p.age);
  if (r.changes > 0) added++;
}

const total = db.prepare('SELECT COUNT(*) as c FROM personalities').get().c;
const politicians = db.prepare("SELECT COUNT(*) as c FROM personalities WHERE category='politician'").get().c;
console.log(`Added: ${added} new politicians`);
console.log(`Total politicians: ${politicians}`);
console.log(`Total personalities: ${total}`);
