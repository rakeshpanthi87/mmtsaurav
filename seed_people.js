require('dotenv').config();
const { db } = require('./database/db');

// 10 fields × 10 people = 100 total
// 5 politicians already exist (Balen Shah, Prachanda, KP Oli, Gagan Thapa, Harka Sampang)

const people = [
  // ── 1. POLITICS (5 more → total 10) ──────────────────────────────
  { name:'Sher Bahadur Deuba',    local:'शेर बहादुर देउवा',    cat:'politician',    gender:'M', age:78, bio:'Five-time Prime Minister of Nepal, president of Nepali Congress.' },
  { name:'Ram Chandra Paudel',    local:'रामचन्द्र पौडेल',     cat:'politician',    gender:'M', age:79, bio:'President of Nepal, senior Nepali Congress leader.' },
  { name:'Bidhya Devi Bhandari',  local:'विद्या देवी भण्डारी',  cat:'politician',   gender:'F', age:63, bio:'Former President of Nepal and first woman to hold the office.' },
  { name:'Rabi Lamichhane',       local:'रवि लामिछाने',        cat:'politician',    gender:'M', age:49, bio:'TV journalist turned politician, leader of Rastriya Swatantra Party.' },
  { name:'Baburam Bhattarai',     local:'बाबुराम भट्टराई',     cat:'politician',    gender:'M', age:72, bio:'Former Prime Minister and architect of Nepal\'s peace process.' },

  // ── 2. CRICKET (10) ──────────────────────────────────────────────
  { name:'Paras Khadka',          local:'पारस खड्का',          cat:'cricket',      gender:'M', age:37, bio:'Former Nepal captain who led the team to ICC World Cup Qualifier.' },
  { name:'Sandeep Lamichhane',    local:'सन्दीप लामिछाने',     cat:'cricket',      gender:'M', age:24, bio:'Nepal\'s premier leg-spinner and IPL star.' },
  { name:'Rohit Paudel',          local:'रोहित पौडेल',         cat:'cricket',      gender:'M', age:22, bio:'Current Nepal cricket captain, youngest ODI centurion.' },
  { name:'Dipendra Singh Airee',  local:'दीपेन्द्र सिंह ऐरी',  cat:'cricket',     gender:'M', age:28, bio:'Explosive Nepal allrounder known for big T20 hitting.' },
  { name:'Kushal Bhurtel',        local:'कुशल भुर्तेल',        cat:'cricket',      gender:'M', age:23, bio:'Rising Nepal batting star with multiple international half-centuries.' },
  { name:'Aasif Sheikh',          local:'आसिफ शेख',            cat:'cricket',      gender:'M', age:28, bio:'Nepal wicket-keeper batsman and key middle-order player.' },
  { name:'Sompal Kami',           local:'सोमपाल कामी',         cat:'cricket',      gender:'M', age:27, bio:'Nepal\'s premier fast bowler with consistent international performances.' },
  { name:'Karan KC',              local:'करण के.सी.',           cat:'cricket',      gender:'M', age:26, bio:'Nepal allrounder known for impactful batting and medium-pace bowling.' },
  { name:'Lalit Rajbanshi',       local:'ललित राजबंशी',        cat:'cricket',      gender:'M', age:31, bio:'Experienced Nepal cricketer and reliable top-order batsman.' },
  { name:'Binod Bhandari',        local:'बिनोद भण्डारी',       cat:'cricket',      gender:'M', age:33, bio:'Nepal\'s experienced wicket-keeper and veteran of ICC events.' },

  // ── 3. FOOTBALL (10) ─────────────────────────────────────────────
  { name:'Sagar Thapa',           local:'सागर थापा',           cat:'football',     gender:'M', age:32, bio:'Nepal\'s most celebrated footballer and long-time national team captain.' },
  { name:'Bimal Gharti Magar',    local:'बिमल घर्ती मगर',      cat:'football',     gender:'M', age:33, bio:'Nepal football captain and defender playing professionally abroad.' },
  { name:'Anjan Bista',           local:'अञ्जन बिष्ट',         cat:'football',     gender:'M', age:27, bio:'Nepal\'s striker in the Australian A-League, top scorer for national team.' },
  { name:'Nirajan Rayamajhi',     local:'निराजन रायमाझी',      cat:'football',     gender:'M', age:29, bio:'Nepal goalkeeper known for crucial saves in international competitions.' },
  { name:'Kiran Chemjong',        local:'किरण केमजोङ',         cat:'football',     gender:'M', age:35, bio:'Veteran Nepal goalkeeper with over 100 international caps.' },
  { name:'Rohit Chand',           local:'रोहित चन्द',           cat:'football',     gender:'M', age:30, bio:'Nepal defender playing in professional European leagues.' },
  { name:'Nawayug Shrestha',      local:'नवयुग श्रेष्ठ',       cat:'football',     gender:'M', age:28, bio:'Creative Nepal midfielder with experience in South Asian tournaments.' },
  { name:'Tej Tamang',            local:'तेज तामाङ',            cat:'football',     gender:'M', age:26, bio:'Young Nepal forward making waves in the ANFA Championship.' },
  { name:'Anil Gurung',           local:'अनिल गुरुङ',          cat:'football',     gender:'M', age:29, bio:'Nepal midfielder known for strong work rate in international matches.' },
  { name:'Bikram Lama',           local:'बिक्रम लामा',          cat:'football',     gender:'M', age:27, bio:'Promising Nepal winger with speed and technical skill.' },

  // ── 4. MOUNTAINEERING (10) ───────────────────────────────────────
  { name:'Nirmal Purja',          local:'निर्मल पुर्जा',        cat:'mountaineering', gender:'M', age:41, bio:'World record holder who summited all 14 eight-thousanders in 6 months.' },
  { name:'Hari Budha Magar',      local:'हरि बुढा मगर',        cat:'mountaineering', gender:'M', age:44, bio:'First double above-knee amputee to summit Mount Everest.' },
  { name:'Pasang Lhamu Sherpa Akita', local:'पासाङ ल्हामु शेर्पा', cat:'mountaineering', gender:'F', age:42, bio:'Award-winning mountaineer and gender equality advocate in climbing.' },
  { name:'Dawa Yangzum Sherpa',   local:'दावा याङजुम शेर्पा',  cat:'mountaineering', gender:'F', age:33, bio:'First Asian woman to climb all 14 eight-thousanders without oxygen.' },
  { name:'Phurba Tashi Sherpa',   local:'फुर्बा ताशी शेर्पा',  cat:'mountaineering', gender:'M', age:51, bio:'Record-holder for most Everest summits with 30 ascents.' },
  { name:'Nima Namgyal Sherpa',   local:'निमा नाम्ग्याल शेर्पा', cat:'mountaineering', gender:'M', age:30, bio:'Youngest person to climb all 14 eight-thousanders, Guinness record holder.' },
  { name:'Mingma Gyalje Sherpa',  local:'मिङ्मा ग्याल्जे शेर्पा', cat:'mountaineering', gender:'M', age:35, bio:'Elite high-altitude climber and member of the historic K2 winter summit team.' },
  { name:'Lakpa Sherpa',          local:'लाक्पा शेर्पा',        cat:'mountaineering', gender:'F', age:52, bio:'Woman with most Everest summits in the world, a nine-time record.' },
  { name:'Ang Rita Sherpa',       local:'अङ रिता शेर्पा',      cat:'mountaineering', gender:'M', age:73, bio:'"Snow Leopard" who summited Everest 10 times without supplemental oxygen.' },
  { name:'Pemba Dorje Sherpa',    local:'पेम्बा दोर्जे शेर्पा', cat:'mountaineering', gender:'M', age:48, bio:'Record-holder for fastest Everest ascent in 8 hours 10 minutes.' },

  // ── 5. MUSIC (10) ────────────────────────────────────────────────
  { name:'Neetesh Jung Kunwar',   local:'नितेश जंग कुँवर',     cat:'music',        gender:'M', age:35, bio:'Nepal\'s most streamed singer-songwriter, known for soulful romantic tracks.' },
  { name:'Sugam Pokhrel',         local:'सुगम पोखरेल',         cat:'music',        gender:'M', age:33, bio:'Popular Nepali singer and composer known for melodious love songs.' },
  { name:'Swoopna Suman',         local:'स्वप्न सुमन',         cat:'music',        gender:'M', age:30, bio:'Indie singer-songwriter whose acoustic tracks dominate Nepali charts.' },
  { name:'Bartika Eam Rai',       local:'बर्तिका इम राई',      cat:'music',        gender:'F', age:28, bio:'Critically acclaimed singer known for emotionally rich indie music.' },
  { name:'Pramod Kharel',         local:'प्रमोद खरेल',         cat:'music',        gender:'M', age:38, bio:'Celebrated Nepali playback singer with decades of chartbuster songs.' },
  { name:'Rajesh Payal Rai',      local:'राजेश पायल राई',     cat:'music',        gender:'M', age:44, bio:'Legendary Nepali singer famous for folk-infused romantic ballads.' },
  { name:'Melina Rai',            local:'मेलिना राई',           cat:'music',        gender:'F', age:40, bio:'Award-winning singer celebrated for her powerful vocal range.' },
  { name:'Wilson Bikram Rai',     local:'विल्सन बिक्रम राई',   cat:'music',        gender:'M', age:45, bio:'Iconic Nepali singer known for soulful voice and enduring classic songs.' },
  { name:'Raju Lama',             local:'राजु लामा',            cat:'music',        gender:'M', age:52, bio:'Pioneer of modern Nepali pop music, Mongolian Heart singer.' },
  { name:'Dibya Subba',           local:'दिव्या सुब्बा',       cat:'music',        gender:'F', age:29, bio:'Popular Nepali pop singer with millions of streams on digital platforms.' },

  // ── 6. FILM & TV (10) ────────────────────────────────────────────
  { name:'Dayahang Rai',          local:'दयाहाङ राई',           cat:'film',         gender:'M', age:40, bio:'Award-winning actor known for Loot, Kabaddi, and the international film White Sun.' },
  { name:'Bipin Karki',           local:'बिपिन कार्की',         cat:'film',         gender:'M', age:40, bio:'Versatile actor and comedian celebrated in both film and theatre.' },
  { name:'Rekha Thapa',           local:'रेखा थापा',            cat:'film',         gender:'F', age:38, bio:'One of Nepal\'s highest-paid actresses and filmmaker with her own production house.' },
  { name:'Priyanka Karki',        local:'प्रियंका कार्की',     cat:'film',         gender:'F', age:32, bio:'Nepali actress, model, and social media star with millions of followers.' },
  { name:'Namrata Shrestha',      local:'नम्रता श्रेष्ठ',      cat:'film',         gender:'F', age:33, bio:'Popular actress and model who also appeared in Bollywood productions.' },
  { name:'Barsha Siwakoti',       local:'बर्षा सिवाकोटी',      cat:'film',         gender:'F', age:27, bio:'Nepali actress who crossed over to Hollywood with the film Hotel Mumbai.' },
  { name:'Paul Shah',             local:'पल शाह',                cat:'film',         gender:'M', age:31, bio:'Actor-singer with massive youth following across social media.' },
  { name:'Saugat Malla',          local:'सौगात मल्ल',           cat:'film',         gender:'M', age:42, bio:'Critically acclaimed actor in Nepal and international art house films.' },
  { name:'Swastima Khadka',       local:'स्वस्तिमा खड्का',     cat:'film',         gender:'F', age:32, bio:'Award-winning actress celebrated for nuanced performances.' },
  { name:'Nischal Basnet',        local:'निश्चल बस्नेत',        cat:'film',         gender:'M', age:36, bio:'Director of Loot and Loot 2, Nepal\'s highest-grossing films of all time.' },

  // ── 7. BUSINESS (10) ─────────────────────────────────────────────
  { name:'Binod Chaudhary',       local:'बिनोद चौधरी',         cat:'business',     gender:'M', age:66, bio:'Nepal\'s only Forbes billionaire, founder of CG Corp Global and Wai Wai noodles.' },
  { name:'Upendra Mahato',        local:'उपेन्द्र महतो',       cat:'business',     gender:'M', age:65, bio:'Prominent NRN businessman and philanthropist based in Russia.' },
  { name:'Shesh Ghale',           local:'शेष घले',              cat:'business',     gender:'M', age:60, bio:'Australia-based Nepali billionaire and former president of NRN.' },
  { name:'Ajeya Raj Sumargi',     local:'अजेय राज सुमार्गी',   cat:'business',     gender:'M', age:55, bio:'Founder of IMS Group and one of Nepal\'s leading media entrepreneurs.' },
  { name:'Basant Chaudhary',      local:'बसन्त चौधरी',         cat:'business',     gender:'M', age:60, bio:'Leading Nepali industrialist and chairman of Chaudhary Group businesses.' },
  { name:'Pawan Golyan',          local:'पवन गोल्यान',          cat:'business',     gender:'M', age:50, bio:'Prominent Nepali investor and founding member of multiple major companies.' },
  { name:'Rajesh Kazi Shrestha',  local:'राजेश काजी श्रेष्ठ', cat:'business',     gender:'M', age:52, bio:'Senior banker and former CEO of leading Nepali commercial banks.' },
  { name:'Siddhartha Rana',       local:'सिद्धार्थ राणा',      cat:'business',     gender:'M', age:58, bio:'President of FNCCI and leading voice of Nepal\'s private sector.' },
  { name:'Chandra Prasad Dhakal', local:'चन्द्र प्रसाद ढकाल',  cat:'business',     gender:'M', age:60, bio:'FNCCI president and influential industrialist shaping Nepal\'s business policy.' },
  { name:'Sujeev Shakya',         local:'सुजीव शाक्य',          cat:'business',     gender:'M', age:55, bio:'Economist, author, and founder of Beed Management, Nepal\'s leading advisory firm.' },

  // ── 8. SOCIAL WORK (10) ──────────────────────────────────────────
  { name:'Pushpa Basnet',         local:'पुष्पा बस्नेत',        cat:'social',       gender:'F', age:41, bio:'CNN Hero 2012 who founded ECDC to care for children of imprisoned parents.' },
  { name:'Anuradha Koirala',      local:'अनुराधा कोइराला',     cat:'social',       gender:'F', age:72, bio:'CNN Hero 2010 and founder of Maiti Nepal, rescuing thousands from trafficking.' },
  { name:'Sanduk Ruit',           local:'सन्दुक रुइत',         cat:'social',       gender:'M', age:69, bio:'World-renowned eye surgeon who has restored sight to over 130,000 cataract patients.' },
  { name:'Mahabir Pun',           local:'महावीर पुन',           cat:'social',       gender:'M', age:66, bio:'Ramon Magsaysay Award winner who brought internet connectivity to remote Nepal.' },
  { name:'Pasang Lhamu Sherpa',   local:'पासाङ ल्हामु शेर्पा',  cat:'social',      gender:'F', age:33, bio:'Mountaineer and UNHCR Goodwill Ambassador advocating for Nepali refugees.' },
  { name:'Rupa Sunar',            local:'रुपा सुनार',           cat:'social',       gender:'F', age:38, bio:'Dalit rights activist and elected official breaking caste barriers in Nepal.' },
  { name:'Phul Maya Shrestha',    local:'फुल माया श्रेष्ठ',    cat:'social',       gender:'F', age:50, bio:'Pioneering advocate for disability rights and inclusion in Nepal.' },
  { name:'Madhu Acharya',         local:'मधु आचार्य',           cat:'social',       gender:'M', age:55, bio:'Award-winning Nepali author and social activist raising literacy awareness.' },
  { name:'Meera Dhungana',        local:'मीरा ढुंगाना',         cat:'social',       gender:'F', age:60, bio:'Leading human rights lawyer and women\'s rights advocate in Nepal.' },
  { name:'Om Gurung',             local:'ओम गुरुङ',             cat:'social',       gender:'M', age:58, bio:'Indigenous rights activist and scholar championing Janajati communities.' },

  // ── 9. COMEDY & ENTERTAINMENT (10) ───────────────────────────────
  { name:'Deepak Raj Giri',       local:'दीपक राज गिरी',       cat:'comedy',       gender:'M', age:45, bio:'Nepali comedian and actor famous for Meri Bassai TV series.' },
  { name:'Sitaram Kattel',        local:'सीताराम कट्टेल',      cat:'comedy',       gender:'M', age:47, bio:'Beloved comedian "Dhurmus" from Nepal\'s iconic comedy duo Dhurmus-Suntali.' },
  { name:'Kunjana Ghimire',       local:'कुञ्जना घिमिरे',      cat:'comedy',       gender:'F', age:45, bio:'"Suntali" of the iconic Dhurmus-Suntali duo and actress.' },
  { name:'Jitu Nepal',            local:'जितु नेपाल',           cat:'comedy',       gender:'M', age:42, bio:'Popular Nepali comedian and content creator known for viral sketches.' },
  { name:'Arjun Ghimire',         local:'अर्जुन घिमिरे',       cat:'comedy',       gender:'M', age:40, bio:'Stand-up comedian and YouTube star with millions of views.' },
  { name:'Bhuwan KC',             local:'भुवन के.सी.',           cat:'comedy',       gender:'M', age:60, bio:'Legendary Nepali actor and filmmaker with 40 years in the industry.' },
  { name:'Jharana Thapa',         local:'झरना थापा',            cat:'comedy',       gender:'F', age:45, bio:'Veteran actress, Miss Nepal 1994, and popular television personality.' },
  { name:'Nir Shah',              local:'नीर शाह',               cat:'comedy',       gender:'M', age:65, bio:'Nepal\'s most celebrated comedy director and founder of the sitcom genre.' },
  { name:'Madan Krishna Shrestha', local:'मदन कृष्ण श्रेष्ठ', cat:'comedy',       gender:'M', age:71, bio:'Legendary comedian and cultural icon known for HaKuSe duo with Hari Bansha.' },
  { name:'Hari Bansha Acharya',   local:'हरि बंश आचार्य',      cat:'comedy',       gender:'M', age:69, bio:'Iconic comedian and playwright, one half of the legendary HaKuSe comedy duo.' },

  // ── 10. MEDIA & JOURNALISM (10) ──────────────────────────────────
  { name:'Sishir Wagle',          local:'शिशिर वाग्ले',         cat:'media',        gender:'M', age:50, bio:'Nepal\'s most famous political cartoonist and social commentator.' },
  { name:'Yubaraj Ghimire',       local:'युवराज घिमिरे',        cat:'media',        gender:'M', age:62, bio:'Veteran journalist and editor who shaped Nepal\'s modern media landscape.' },
  { name:'Kanak Mani Dixit',      local:'कनक मणि दीक्षित',     cat:'media',        gender:'M', age:66, bio:'Publisher of Himal Magazine and leading voice in South Asian journalism.' },
  { name:'Arjun Thapaliya',       local:'अर्जुन थापलिया',      cat:'media',        gender:'M', age:48, bio:'Senior TV anchor and editor known for hard-hitting political interviews.' },
  { name:'Rupa Joshi',            local:'रुपा जोशी',            cat:'media',        gender:'F', age:45, bio:'BBC journalist and one of Nepal\'s most prominent investigative reporters.' },
  { name:'Dinesh DC',             local:'दिनेश डी.सी.',         cat:'media',        gender:'M', age:35, bio:'Nepal\'s most popular YouTuber with millions of subscribers.' },
  { name:'Geetanjali Thapa',      local:'गीतान्जली थापा',       cat:'media',        gender:'F', age:35, bio:'National Award-winning actress and rising cultural voice in Nepali media.' },
  { name:'Prabhat Adhikari',      local:'प्रभात अधिकारी',      cat:'media',        gender:'M', age:45, bio:'Senior television journalist and host of popular political debate shows.' },
  { name:'Narayan Wagle',         local:'नारायण वाग्ले',        cat:'media',        gender:'M', age:55, bio:'Novelist, journalist, and editor known for Palpasa Cafe and media activism.' },
  { name:'Bina Thebe',            local:'बिना थेबे',             cat:'media',        gender:'F', age:40, bio:'Prominent Nepali journalist and anchor covering politics and human rights.' },
];

const catColor = {
  politician:    { bg:'#3B82F6', fg:'#FFFFFF' },
  cricket:       { bg:'#10B981', fg:'#FFFFFF' },
  football:      { bg:'#059669', fg:'#FFFFFF' },
  mountaineering:{ bg:'#6366F1', fg:'#FFFFFF' },
  music:         { bg:'#EC4899', fg:'#FFFFFF' },
  film:          { bg:'#8B5CF6', fg:'#FFFFFF' },
  business:      { bg:'#F59E0B', fg:'#FFFFFF' },
  social:        { bg:'#14B8A6', fg:'#FFFFFF' },
  comedy:        { bg:'#F97316', fg:'#FFFFFF' },
  media:         { bg:'#64748B', fg:'#FFFFFF' },
};

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
function initials(name) {
  const parts = name.split(' ').filter(Boolean);
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}

const ins = db.prepare(`
  INSERT OR IGNORE INTO personalities
    (slug, name, name_local, category, nationality, bio, initials, avatar_bg, avatar_fg, verified, gender, age)
  VALUES (?, ?, ?, ?, 'Nepali', ?, ?, ?, ?, 1, ?, ?)
`);

let added = 0;
for (const p of people) {
  const c = catColor[p.cat] || { bg:'#6B7280', fg:'#FFFFFF' };
  const r = ins.run(slug(p.name), p.name, p.local, p.cat, p.bio, initials(p.name), c.bg, c.fg, p.gender, p.age);
  if (r.changes > 0) added++;
}

const total = db.prepare('SELECT COUNT(*) as c FROM personalities').get().c;
const byCat = db.prepare('SELECT category, COUNT(*) as c FROM personalities GROUP BY category ORDER BY c DESC').all();
console.log(`Added: ${added} | Total: ${total}`);
console.log('\nBreakdown:');
byCat.forEach(r => console.log(`  ${r.category.padEnd(16)} ${r.c}`));
