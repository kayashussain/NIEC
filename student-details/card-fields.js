// What a student card holds besides the sheet: the choices of every dropdown on the card, the documents a
// student is asked for, and the names of the details. Kept in one place so the card page, the server and the
// Dashboard all read the same lists (a choice added here appears everywhere at once).
// Loaded by the pages as window.CardFields and by the server and the tests with require.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CardFields = factory();
})(typeof self !== 'undefined' ? self : this, () => {
  // "Where exactly": the second step of each Student Source. Each list is only the starting choices: anyone can add a choice
  // that is missing (a new platform, a new event with its date) and it is then offered to everyone, so every student of the
  // same platform or event is tagged with the very same words (see source-options.js). Events and B2B partners have no
  // starting choices: an event is added with its date, a B2B partner comes from the B2B Partners page.
  // The branches. To add a branch, add its name here and in the Users page list of branch teams (shared/teams.js reads this list):
  // the Student Source is then "<name> Branch" (for example "Chitwan Branch"), which is how the incentive sums and the branch
  // accounts have always recognised a branch student.
  const BRANCHES = ['Chitwan', 'Pokhara', 'Palpa', 'Butwal'];
  const branchValue = (name) => `${name} Branch`;
  const isBranchValue = (v) => /\S\s+branch$/i.test(String(v || '').trim());
  // The Student Source as the forms show it (Branch is one choice with a second dropdown) and as the sheet keeps it ("Chitwan Branch").
  // University Partner of a direct application is written "Direct (<university>)" (the owner, 22 Nov 2026). Counted as before, by the
  // university's own name, so the Dashboard, Partners and B2B Partners see a direct application as they always did.
  const plainPartner = (v) => { const t = String(v || '').trim(); const m = /^direct\s*\((.+)\)$/i.exec(t); return m ? m[1].trim() : t; };
  const sourceGroup = (stored) => (isBranchValue(stored) ? 'Branch' : String(stored || '').trim());
  const branchName = (stored) => String(stored || '').trim().replace(/\s+branch$/i, '');
  const storedSource = (group, detail) => (group === 'Branch' ? (detail ? branchValue(detail) : '') : group);
  const SOURCE_DETAILS = {
    // The platforms students really come from (the owner, 14 Nov 2026: Messenger is Facebook; no leads from YouTube, LinkedIn or Viber).
    // Then the form asks whether it was organic or an advert, and an advert is one of the campaigns on Events and marketing.
    'Social Media': ['Facebook', 'Instagram', 'TikTok', 'WhatsApp'],
    Visitor: ['Walked in', 'Phone call', 'Website form', 'Google search or Maps', 'Signboard or hoarding', 'Newspaper, radio or TV'],
    Reference: [], // typed: who referred the student (the owner, 14 Nov 2026)
    'Language Classes': ['IELTS class', 'PTE class', 'Duolingo class'],
    Events: [],
    Agent: [],
    Branch: BRANCHES,
  };
  // What the "where exactly" box is called for each source, and the sources a new choice can be added to.
  // The values the sheet's Student Source column holds: the sources, and one "<name> Branch" for each branch.
  const STORED_SOURCES = [...Object.keys(SOURCE_DETAILS).filter((k) => k !== 'Branch'), ...BRANCHES.map(branchValue)];
  const SOURCE_DETAIL_LABEL = {
    'Social Media': 'Which platform or page', Visitor: 'How they reached us', Reference: 'Who referred them', 'Language Classes': 'Which class',
    Events: 'Which event or marketing', Agent: 'Which agent', Branch: 'Which branch',
  };
  const SOURCE_CAN_ADD = ['Social Media', 'Visitor', 'Language Classes']; // Events are added by Admin under Events and marketing, not here (the owner, 25 Nov 2026)

  // Nepal's 77 districts, for where a student lives (the owner, 14 Nov 2026: the Dashboard's map of where students come from).
  const DISTRICTS = ["Achham", "Arghakhanchi", "Baglung", "Baitadi", "Bajhang", "Bajura", "Banke", "Bara", "Bardiya", "Bhaktapur", "Bhojpur", "Chitwan", "Dadeldhura", "Dailekh", "Dang", "Darchula", "Dhading", "Dhankuta", "Dhanusha", "Dolakha", "Dolpa", "Doti", "Gorkha", "Gulmi", "Humla", "Ilam", "Jajarkot", "Jhapa", "Jumla", "Kailali", "Kalikot", "Kanchanpur", "Kapilvastu", "Kaski", "Kathmandu", "Kavrepalanchok", "Khotang", "Lalitpur", "Lamjung", "Mahottari", "Makwanpur", "Manang", "Morang", "Mugu", "Mustang", "Myagdi", "Nawalpur (Nawalparasi East)", "Nuwakot", "Okhaldhunga", "Palpa", "Panchthar", "Parasi (Nawalparasi West)", "Parbat", "Parsa", "Pyuthan", "Ramechhap", "Rasuwa", "Rautahat", "Rolpa", "Rukum East", "Rukum West", "Rupandehi", "Salyan", "Sankhuwasabha", "Saptari", "Sarlahi", "Sindhuli", "Sindhupalchok", "Siraha", "Solukhumbu", "Sunsari", "Surkhet", "Syangja", "Tanahun", "Taplejung", "Terhathum", "Udayapur"];
  // The district of a place as people write it ("Butwal", "Pokhara-8, Kaski", "kathmandu"): a district named in it, or the district of
  // a big town. '' when it cannot be told.
  const TOWNS = { butwal: 'Rupandehi', bhairahawa: 'Rupandehi', siddharthanagar: 'Rupandehi', pokhara: 'Kaski', bharatpur: 'Chitwan', narayangarh: 'Chitwan', biratnagar: 'Morang', birgunj: 'Parsa', dharan: 'Sunsari', itahari: 'Sunsari', nepalgunj: 'Banke', dhangadhi: 'Kailali', hetauda: 'Makwanpur', janakpur: 'Dhanusha', damak: 'Jhapa', birtamod: 'Jhapa', tansen: 'Palpa', ghorahi: 'Dang', tulsipur: 'Dang', patan: 'Lalitpur', kirtipur: 'Kathmandu', banepa: 'Kavrepalanchok', dhulikhel: 'Kavrepalanchok', kavre: 'Kavrepalanchok', mahendranagar: 'Kanchanpur', birendranagar: 'Surkhet', gaur: 'Rautahat', kalaiya: 'Bara', lahan: 'Siraha', rajbiraj: 'Saptari', waling: 'Syangja', damauli: 'Tanahun', baglung: 'Baglung', besisahar: 'Lamjung', gorkha: 'Gorkha', bidur: 'Nuwakot', ilam: 'Ilam', nawalparasi: 'Nawalpur (Nawalparasi East)', kawasoti: 'Nawalpur (Nawalparasi East)', parasi: 'Parasi (Nawalparasi West)', ktm: 'Kathmandu' };
  function districtOf(place) {
    const t = String(place || '').toLowerCase();
    if (!t.trim()) return '';
    const named = DISTRICTS.find((d) => t.includes(d.toLowerCase().replace(/\s*\(.*\)$/, '')));
    if (named) return named;
    const town = Object.keys(TOWNS).find((k) => new RegExp(`\\b${k}\\b`).test(t));
    return town ? TOWNS[town] : '';
  }
  // As written in the passport (the owner, 21 Nov 2026: as Route2Uni keeps it); optional.
  const GENDERS = ['Female', 'Male', 'Other'];
  const NATIONALITIES = ['Nepali', 'Indian', 'Chinese', 'Bangladeshi', 'Bhutanese', 'Sri Lankan', 'Pakistani', 'Other'];
  const SOURCE_WAYS = ['Organic', 'Advert'];
  // The study levels offered (the owner, 14 Nov 2026: an MBA is postgraduate). The two older ones a card may still hold stay readable.
  const STUDY_LEVELS = ['Foundation', 'International Year 1', 'Top-up (final year)', 'Undergraduate', 'Pre-Masters', 'Postgraduate', 'Masters by Research or PhD'];
  const OLDER_STUDY_LEVELS = { MBA: 'Postgraduate', 'MRes or PhD': 'Masters by Research or PhD' };
  const QUALIFICATIONS = ['SEE (Grade 10)', '+2 or Grade 12', 'A Levels', 'Diploma or PCL', 'Bachelor (3 years)', 'Bachelor (4 years)', 'Masters'];
  const ENGLISH_TESTS = ['IELTS Academic', 'IELTS UKVI', 'PTE Academic', 'PTE UKVI', 'Duolingo', 'TOEFL iBT', 'OET', 'University Internal Test', 'MOI or Waiver', 'Not Taken Yet'];
  // Why a student did not go on. Fixed choices, so the Dashboard can count them (free typing would give ten spellings of one reason).
  const LOST_REASONS = [
    'Chose another consultancy', 'Applied by themselves', 'Chose another country', 'Fees or deposit too high',
    'Funds or bank balance not ready', 'English score not enough', 'Grades or study gap not accepted',
    'Course or university not available with us', 'University rejected the application', 'Failed the credibility or Pre-CAS interview',
    'Visa refused', 'Family or personal decision', 'Postponed to a later intake', 'Stopped answering', 'Duplicate or wrong entry', 'Other',
  ];
  // The stages at which a lost reason is asked for.
  const LOST_STAGES = ['Withdrawn', 'Hold', 'Defer', 'Visa Rejected'];
  // The kinds notes were once kept with. A new note is always a plain note (the owner, 14 Nov 2026); the others stay readable.
  const NOTE_KINDS = [
    { key: 'note', text: 'Note' }, { key: 'call', text: 'Phone call' }, { key: 'meeting', text: 'Office visit' }, { key: 'message', text: 'Message' },
    // Written by Student Recruit 360 itself: a stage moved on ("Moved to Mock Stage"), and a call from the follow-up list that nobody answered. Neither
    // counts as speaking to the student (the owner, 21 Nov 2026).
    { key: 'stage', text: 'Stage' }, { key: 'try', text: 'Called, no answer' },
  ];
  // The Follow-up Team's tags (the owner, 21 Nov 2026): how warm a student is, one at a time, changed with one press in the follow-up
  // list. The table shows the short form.
  const FOLLOW_TAGS = [
    { key: 'Interested', short: 'INT' }, { key: 'Decision Making', short: 'DM' }, { key: 'Cold', short: 'COLD' },
  ];

  // The documents a student is asked for to apply (the checklist that goes in the email). CAS and visa documents are asked
  // for later, in person.
  const DOCUMENTS = [
    { key: 'passport', text: 'Passport (the page with the photo)' },
    { key: 'see', text: 'SEE (Grade 10) mark sheet and certificate' },
    { key: 'plus2', text: '+2 (Grade 12) transcript, certificate and character certificate' },
    { key: 'bachelor', text: 'Bachelor transcript, degree certificate and character certificate', levels: ['Pre-Masters', 'Postgraduate', 'MBA', 'MRes or PhD', 'Masters by Research or PhD'] },
    { key: 'english', text: 'English test result (IELTS, PTE or other), or the MOI letter' },
    { key: 'cv', text: 'CV (up to date)' },
    { key: 'sop', text: 'Statement of purpose (SOP)' },
    { key: 'lor', text: 'Two recommendation letters (teacher or employer)', levels: ['Top-up (final year)', 'Pre-Masters', 'Postgraduate', 'MBA', 'MRes or PhD', 'Masters by Research or PhD'] },
    { key: 'work', text: 'Work experience letters (for any study gap)' },
    { key: 'refusal', text: 'Any earlier visa refusal letter (any country)' },
  ];
  // The documents for a study level. With no level known, only the ones every student needs.
  const documentsFor = (level) => DOCUMENTS.filter((d) => !d.levels || (level && d.levels.includes(level)));

  // The details kept on the card, with the name shown and how each is typed. `list` names one of the lists above.
  const PROFILE_FIELDS = [
    { key: 'sourceDetail', label: 'Where exactly', max: 120 },
    { key: 'sourceRemarks', label: 'Campaign or remarks', max: 160 },
    { key: 'inquiryDate', label: 'First inquiry day', type: 'date' },
    { key: 'inquiryTime', label: 'First inquiry time', max: 12 }, // "9:21 pm", from a lead list
    { key: 'studyLevel', label: 'Study level', list: 'STUDY_LEVELS' },
    { key: 'qualification', label: 'Highest qualification', list: 'QUALIFICATIONS' },
    { key: 'grade', label: 'GPA or percentage', max: 40 },
    { key: 'passedYear', label: 'Year passed', max: 10 },
    { key: 'gapYears', label: 'Study gap (years)', max: 4 },
    { key: 'englishTest', label: 'English test', list: 'ENGLISH_TESTS' },
    { key: 'englishScore', label: 'English score', max: 60 },
    { key: 'englishBand', label: 'Lowest English band', max: 10 }, // the lowest of the four parts (the eligibility finder)
    { key: 'budget', label: 'Budget for the first year (GBP)', max: 60 },
    { key: 'location', label: 'Where in the UK', max: 120 },
    { key: 'subject', label: 'Subject or course wanted', max: 160 },
    { key: 'optionRemarks', label: 'Remarks for the university options', max: 1500 },
    // The phone (last 10 digits), email and name a lead list gave, kept so a student removed from the sheet is not added back by a list.
    { key: 'leadContact', label: 'Phone and email from a lead list', max: 300 },
    // The event or campaign whose uploaded list added this student (so its students can be removed again to upload a better list).
    { key: 'fromList', label: 'Added by the list of', max: 20 },
    { key: 'lostReason', label: 'Why the student did not go on', list: 'LOST_REASONS' },
    // From the passport (the owner, 14 Nov 2026): the date of birth, the passport number, the address as written in it and the
    // nationality. The address gives the district for the Dashboard's map; the nationality counts the students from outside Nepal.
    // Who last saved the profile with Edit profile, and when (the owner, 21 Nov 2026: every change shows who saved it and when). Set
    // by the server only, never typed.
    { key: 'savedAt', label: 'Profile last saved', max: 40 },
    { key: 'savedBy', label: 'Profile saved by', max: 80 },
    { key: 'dob', label: 'Date of birth', type: 'date' },
    { key: 'passportNo', label: 'Passport number', max: 20 },
    { key: 'address', label: 'Address (as in the passport)', max: 200 },
    { key: 'nationality', label: 'Nationality', list: 'NATIONALITIES' },
    // Also from the passport (the owner, 21 Nov 2026): when it runs out (a visa needs six months or more left), and the gender. Optional.
    { key: 'passportExpiry', label: 'Passport expiry', type: 'date' },
    { key: 'gender', label: 'Gender', list: 'GENDERS' },
    // How a Social Media student came: the platform, and whether by itself or from an advert (the advert is the campaign in
    // sourceDetail, so it is counted in its cost).
    { key: 'sourcePlatform', label: 'Platform', max: 40 },
    { key: 'sourceWay', label: 'Organic or advert', list: 'SOURCE_WAYS' },
    // Kept only so the few values saved on 14 Nov 2026 are not lost; no longer asked (the address replaces them).
    { key: 'livesIn', label: 'Lived in (district)', list: 'DISTRICTS' },
    { key: 'homeDistrict', label: 'Home district', list: 'DISTRICTS' },
  ];

  // The sheet's columns in the groups the card shows them in (the card never changes them: the sheet does).
  const SHEET_SECTIONS = [
    { title: 'Application', columns: ['APPLICATION STATUS', 'APPLICATION SUBMISSION DATE', 'OFFER RECEIVED DATE', 'UNIVERSITY NAME', 'COURSE NAME', 'RECEIVING PARTNER', 'UNIVERSITY PARTNER', 'LANGUAGE TEST DATE', 'STUDENT ID'] },
    { title: 'Interviews and documents', columns: ['NOC', 'NOC NUMBER', 'MOCK SCHEDULE 1', 'FEEDBACK 1', 'MOCK SCHEDULE 2', 'FEEDBACK 2', 'MOCK SCHEDULE 3', 'FEEDBACK 3', 'MOCK SCHEDULE 4', 'FEEDBACK 4', 'PRE CAS INTERVIEW', 'MEDICAL REPORT'] },
    { title: 'Fees and payment', columns: ['GROSS FEE', 'SCHOLARSHIP', 'FEE AFTER SCHOLARSHIP', 'EARLY BIRD DISCOUNT', 'ADDITIONAL DISCOUNT', 'TUITION FEE DEPOSIT(1st Installment)', 'TUITION FEE DEPOSIT(2nd Installment)', 'TUITION FEE DEPOSIT(3rd Installment)', 'REMAINING TUITION FEE', 'PAYMENT DATE'] },
    { title: 'CAS and visa', columns: ['CAS REQUESTED DATE', 'CAS RECEIVED DATE', 'VISA LODGE DATE', 'VFS ATTENDED DATE', 'VISA RECEIVED DATE', 'E-VISA', 'UK CONTACT NUMBER'] },
  ];
  const COLUMN_LABELS = {
    'APPLICATION STATUS': 'Stage', 'APPLICATION SUBMISSION DATE': 'Application submitted', 'OFFER RECEIVED DATE': 'Offer received',
    'CONTACT NUMBER': 'Contact number (WhatsApp)', 'LANGUAGE TEST DATE': 'Language test', 'GROSS FEE': 'Gross fee (£)', SCHOLARSHIP: 'Scholarship (£ or %)',
    'FEE AFTER SCHOLARSHIP': 'Fee after scholarship (£)', 'EARLY BIRD DISCOUNT': 'Early bird discount (£ or %)', 'ADDITIONAL DISCOUNT': 'Additional discount (£)',
    'TUITION FEE DEPOSIT(1st Installment)': '1st installment paid (£)', 'TUITION FEE DEPOSIT(2nd Installment)': '2nd installment paid (£)',
    'TUITION FEE DEPOSIT(3rd Installment)': '3rd installment paid (£)', 'REMAINING TUITION FEE': 'Remaining tuition fee (£)',
    'PRE CAS INTERVIEW': 'Pre-CAS interview', 'E-VISA': 'E-Visa',
  };
  const KEEP_CAPS = new Set(['CAS', 'NOC', 'UK', 'VFS', 'ID']);
  const columnLabel = (col) => COLUMN_LABELS[col] || String(col).split(' ')
    .map((w, i) => (KEEP_CAPS.has(w) ? w : (i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase()))).join(' ');

  // A Nepal mobile number as WhatsApp wants it (country code, digits only): "9801234567" and "+977 980-1234567"
  // both become "9779801234567". A number that already carries another country code is kept. '' when it is not a number.
  function whatsappNumber(raw) {
    let d = String(raw ?? '').replace(/[^\d+]/g, '');
    if (d.startsWith('+')) d = d.slice(1);
    else if (d.startsWith('00')) d = d.slice(2);
    else if (/^9[678]\d{8}$/.test(d)) d = '977' + d; // a Nepal mobile typed without the country code
    else if (/^0\d{9,10}$/.test(d)) d = '977' + d.slice(1);
    d = d.replace(/\D/g, '');
    return d.length >= 8 && d.length <= 15 ? d : '';
  }

  // What a task is about (the owner, 15 Nov 2026): a tag, so Today can show the tasks in calm groups. NOC and Medical are tags of
  // their own (the owner, 15 Nov 2026), as each is its own piece of work for the team.
  const TASK_TAGS = [['application', 'Application'], ['offer', 'Offer request'], ['mock', 'Mock interview'], ['mock-feedback', 'Feedback'], ['mock-booking', 'Date booking'], ['mock-precas', 'Pre-CAS result'], ['payment', 'Payment'], ['documents', 'Documents'], ['noc', 'NOC'], ['medical', 'Medical'], ['visa', 'Visa and CAS'], ['other', 'Other']];
  const TASK_TAG_IDS = TASK_TAGS.map(([k]) => k);
  // The tags a person chooses from when giving or editing a task (the owner, 20 Nov 2026): Application, Mock interview, Documents, NOC,
  // Medical and Other. Offer request, Payment and Visa and CAS are no longer offered; tasks that already carry one keep it and still show
  // it (Student Recruit 360's own "Offer request" task after a submission keeps its tag), so stored tasks keep their meaning.
  // Documents is no longer a kind of its own (the owner, 21 Nov 2026): documents are part of the application, so the five kinds a person
  // chooses from are Application, Mock interview, NOC, Medical and Other. Offer request is made by Student Recruit 360 only, after an application is
  // submitted. The Documents tasks already saved were moved to Application once at start-up (see server.js).
  const TASK_TAGS_CHOOSABLE = TASK_TAGS.filter(([k]) => ['application', 'documents', 'mock', 'mock-feedback', 'mock-booking', 'mock-precas', 'noc', 'medical', 'other'].includes(k)); // Documents is a kind a person can choose again (the owner, 25 Nov 2026): for example the Application Team asking a branch for an additional document
  // A course leaves the Shortlist for good once it has gone to the Application Team (the owner, 18 Nov 2026): given to the team, applied
  // to, answered (offer, refused, withdrawn) or decided not to be submitted. The Shortlist holds only courses still to be assigned.
  const WITH_TEAM = (o) => Boolean(o && (o.sent || o.applied || o.offer || o.refused || o.withdrawn || o.skipped));
  const onShortlist = (o) => !WITH_TEAM(o);
  // The tag a task gets when none was chosen (older tasks, or a quick assign): from the words, then the team, then the student's stage.
  // The Mock Team's four kinds of work (the owner, 25 Nov 2026): Mock interview (a mock to book), Feedback (of a mock held), Date booking (the Pre-CAS or final
  // interview to book) and Pre-CAS result. A task typed by hand is read from its words; the Mock interview is the kind left over.
  function mockSub(t, team) {
    const mockish = team === 'mock' || /\b(mock|interview|pre-?cas|final)\b/.test(t);
    if (!mockish) return '';
    if (/\bfeedback\b/.test(t)) return 'mock-feedback';
    if (/\bpre-?cas\b[^.]*\b(results?|passed|fail(ed)?)\b|\bresults?\b[^.]*\bpre-?cas\b/.test(t)) return 'mock-precas';
    if (/\b(book|booking|booked|date)\b[^.]*\b(pre-?cas|final)\b|\b(pre-?cas|final)\b[^.]*\b(book|booking|booked|date)\b/.test(t)) return 'mock-booking';
    return '';
  }
  // A "Mock interview" task saved before the four kinds existed carried its kind in its first words.
  const legacyMock = (text) => { const t = String(text || '').trim().toLowerCase(); return /^feedback\b|^write the feedback of mock/.test(t) ? 'mock-feedback' : /^final interview booking/.test(t) ? 'mock-booking' : /^pre-?cas interview result/.test(t) ? 'mock-precas' : ''; };
  function guessTaskTag(text, team, stage) {
    const t = String(text || '').toLowerCase();
    if (/^offer request\b/.test(t)) return 'offer'; // the task made when an application is submitted
    if (/\boffer (letter|request)\b|\b(chase|follow up|check)\b.*\boffer\b/.test(t)) return 'offer'; // asking a university for the offer letter is an Offer request (the owner, 25 Nov 2026)
    // The Follow-up Team calls and talks: a task for it is never read as payment, visa or application work from its words (a word like
    // "deposit" once made the "Mark as done?" window ask the team about a payment). A kind chosen by the giver still counts.
    if (team === 'followup') return 'other';
    if (/\bnoc\b|no objection/.test(t)) return 'noc';
    // "medicals", "medical test", "IOM", "TB test", "chest x-ray", "health check" (the owner, 15 Nov 2026: medical tasks were tagged
    // Other or Payment). The health surcharge (IHS) is a payment, not a medical.
    if (/\b(medicals?|health ?check|iom|tb|tuberculosis|x-?ray|clinic|hospital|doctor)\b/.test(t)) return 'medical';
    if (/\b(pay|payment|deposit|fee|fees|invoice|receipt|tuition|refund)\b/.test(t)) return 'payment';
    { const sub = mockSub(t, team); if (sub) return sub; }
    if (/\bpre-?cas\b/.test(t)) return 'mock'; // the Pre-CAS interview is the last mock, not the visa
    if (/\b(visa|cas|vfs|biometric|e-?visa|brp|lodge)\b/.test(t)) return 'visa';
    if (/\b(mock|interview|pre-?cas)\b/.test(t)) return 'mock';
    // Asking the student for a document (a missing transcript, a passport copy) is a Documents task: finishing it asks nothing about a university (the owner, 25 Nov 2026).
    if (/\b(ask|request|collect|remind|chase|get)\b.*\b(document|documents|passport|transcript|certificate|bank statement|sop|cv|ielts|pte|toefl|moi)\b/.test(t)) return 'documents';
    // Documents are part of the application (the owner, 21 Nov 2026).
    if (/\b(document|documents|passport|transcript|certificate|bank statement|sop|cv|ielts|pte|toefl|moi)\b/.test(t)) return 'application';
    if (/\b(apply|application|submit|offer|portal|university|course)\b/.test(t)) return 'application';
    if (team === 'mock') return 'mock';
    if (team === 'application') return 'application';
    const st = String(stage || '');
    if (/Payment/.test(st)) return 'payment';
    if (/CAS|Visa/.test(st)) return 'visa';
    if (/Mock/.test(st)) return 'mock';
    if (/Application/.test(st)) return 'application';
    return 'other';
  }
  const taskTag = (task, stage) => (TASK_TAG_IDS.includes(task && task.tag) ? (task.tag === 'mock' ? legacyMock(task.text) || 'mock' : task.tag) : guessTaskTag(task && task.text, task && task.team, stage));
  const isMockTag = (k) => k === 'mock' || k === 'mock-feedback' || k === 'mock-booking' || k === 'mock-precas';
  // The task Student Recruit 360 gives by itself on the day of a medical test ("Medical test of 19 Nov 2026 at Norvic: is the report received?").
  // It is about the report, not about booking, so finishing it never asks for a booking again (see finishPlan in portal-api.js).
  const isReportCheck = (task) => /^Medical test of .+: is the report received\?$/i.test(String((task && task.text) || '').trim());
  // How important a task is, chosen by whoever gives it (the owner, 15 Nov 2026): every task is Priority unless it is marked Super
  // priority or Medium. Older tasks with nothing chosen count as Priority.
  const TASK_PRIORITIES = [['super', 'Super priority'], ['high', 'Priority'], ['medium', 'Medium']];
  const TASK_PRIORITY_IDS = TASK_PRIORITIES.map(([k]) => k);
  const taskPriorityOf = (task) => (TASK_PRIORITY_IDS.includes(task && task.priority) ? task.priority : 'high');

  return {
    TASK_TAGS, TASK_TAG_IDS, TASK_TAGS_CHOOSABLE, isMockTag, guessTaskTag, WITH_TEAM, onShortlist, taskTag, isReportCheck, TASK_PRIORITIES, TASK_PRIORITY_IDS, taskPriorityOf, BRANCHES, STORED_SOURCES, branchValue, isBranchValue, plainPartner, sourceGroup, branchName, storedSource,
    SOURCE_DETAILS, SOURCE_DETAIL_LABEL, SOURCE_CAN_ADD, STUDY_LEVELS, QUALIFICATIONS, ENGLISH_TESTS, LOST_REASONS, LOST_STAGES,
    OLDER_STUDY_LEVELS, DISTRICTS, districtOf, NATIONALITIES, SOURCE_WAYS, NOTE_KINDS, FOLLOW_TAGS, DOCUMENTS, documentsFor, PROFILE_FIELDS, GENDERS, SHEET_SECTIONS, columnLabel, whatsappNumber,
  };
});
