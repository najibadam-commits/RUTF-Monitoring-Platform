// TPM Monitoring Platform — mock/sample data. Structured so it can be swapped
// for a live API without redesigning the frontend (see README note at bottom).

export const STATUS_ORDER = ['New', 'Assigned', 'In Progress', 'Resolved', 'Verified/Closed'];

export const STATUS_COLOR = {
  'New': '#b2b6ca',
  'Assigned': '#b5abfc',
  'In Progress': '#d7a24a',
  'Resolved': '#6fb98a',
  'Verified/Closed': '#e7e5fe',
};

export const PRIORITY_COLOR = {
  'Critical': '#d97a6a',
  'High': '#d7a24a',
  'Medium': '#b5abfc',
  'Low': '#9397ab',
};

export const CATEGORIES = [
  'Water & Sanitation Failure',
  'Supply Chain / Stockout',
  'Infrastructure Damage',
  'Safety Incident',
  'Service Quality Complaint',
  'Data Discrepancy',
  'Staff Absenteeism',
  'Equipment Malfunction',
  'Environmental Hazard',
  'Community Grievance',
];

// Rough relative placement on a 0-100 x/y grid, loosely approximating each
// state's position within the country outline drawn on the GIS map.
export const STATES = [
  { name: 'Sokoto', x: 18, y: 10, lgas: ['Wamakko', 'Bodinga', 'Dange'] },
  { name: 'Kano', x: 46, y: 12, lgas: ['Nassarawa', 'Dala', 'Fagge'] },
  { name: 'Borno', x: 78, y: 18, lgas: ['Konduga', 'Jere', 'Mafa'] },
  { name: 'Kaduna', x: 42, y: 30, lgas: ['Chikun', 'Zaria', 'Kachia'] },
  { name: 'Kwara', x: 26, y: 42, lgas: ['Ilorin West', 'Asa', 'Offa'] },
  { name: 'Oyo', x: 16, y: 54, lgas: ['Ibadan North', 'Ogbomosho', 'Iseyin'] },
  { name: 'Lagos', x: 9, y: 68, lgas: ['Ikeja', 'Eti-Osa', 'Alimosho'] },
  { name: 'Enugu', x: 56, y: 56, lgas: ['Enugu East', 'Nsukka', 'Udi'] },
  { name: 'Rivers', x: 50, y: 80, lgas: ['Port Harcourt', 'Obio-Akpor', 'Eleme'] },
  { name: 'Cross River', x: 70, y: 76, lgas: ['Calabar South', 'Ogoja', 'Obudu'] },
];

const WARD_NAMES = ['Central Ward', 'North Ward', 'South Ward', 'Riverside Ward', 'Market Ward'];

export const DRIS = [
  { id: 'dri-1', name: 'Amaka Obi', title: 'District Health Officer' },
  { id: 'dri-2', name: 'Ibrahim Suleiman', title: 'Facility Manager' },
  { id: 'dri-3', name: 'Grace Effiong', title: 'Ward Engineer' },
  { id: 'dri-4', name: 'Musa Bello', title: 'Program Coordinator' },
  { id: 'dri-5', name: 'Ngozi Eze', title: 'Logistics Officer' },
  { id: 'dri-6', name: 'Yakubu Danladi', title: 'Site Supervisor' },
  { id: 'dri-7', name: 'Chiamaka Nwosu', title: 'Community Liaison' },
  { id: 'dri-8', name: 'Aliyu Garba', title: 'Infrastructure Officer' },
];

export const TPMS = [
  { id: 'tpm-1', name: 'Fatima Yusuf' },
  { id: 'tpm-2', name: 'Emeka Okafor' },
  { id: 'tpm-3', name: 'Blessing Adeyemi' },
  { id: 'tpm-4', name: 'Suleiman Abdullahi' },
  { id: 'tpm-5', name: 'Joy Okonkwo' },
];

export const USERS = [
  { id: 'u-1', name: 'Fatima Yusuf', email: 'f.yusuf@tpmops.org', phone: '+234 803 111 2201', role: 'Admin', status: 'Active', lastLogin: '2026-08-04 09:12' },
  { id: 'u-2', name: 'Emeka Okafor', email: 'e.okafor@tpmops.org', phone: '+234 805 222 3302', role: 'TPM Supervisor', status: 'Active', lastLogin: '2026-08-05 07:44' },
  { id: 'u-3', name: 'Blessing Adeyemi', email: 'b.adeyemi@tpmops.org', phone: '+234 802 333 4403', role: 'TPM Supervisor', status: 'Active', lastLogin: '2026-08-04 16:20' },
  { id: 'u-4', name: 'Suleiman Abdullahi', email: 's.abdullahi@tpmops.org', phone: '+234 807 444 5504', role: 'TPM Supervisor', status: 'Inactive', lastLogin: '2026-07-22 11:03' },
  { id: 'u-5', name: 'Amaka Obi', email: 'a.obi@tpmops.org', phone: '+234 809 555 6605', role: 'DRI', status: 'Active', lastLogin: '2026-08-03 14:55' },
  { id: 'u-6', name: 'Grace Effiong', email: 'g.effiong@tpmops.org', phone: '+234 806 666 7706', role: 'DRI', status: 'Active', lastLogin: '2026-08-05 08:02' },
  { id: 'u-7', name: 'Joy Okonkwo', email: 'j.okonkwo@tpmops.org', phone: '+234 810 777 8807', role: 'Viewer', status: 'Active', lastLogin: '2026-07-30 10:11' },
];

const DESCRIPTIONS = {
  'Water & Sanitation Failure': 'Borehole pump reported non-functional; community relying on unsafe surface water source.',
  'Supply Chain / Stockout': 'Facility stock of essential commodities depleted; last restock delayed beyond schedule.',
  'Infrastructure Damage': 'Access road to facility washed out following heavy rains, restricting supply deliveries.',
  'Safety Incident': 'Field team reported an unsafe storage condition posing risk to staff and visitors.',
  'Service Quality Complaint': 'Community members reported long wait times and inconsistent service delivery.',
  'Data Discrepancy': 'Reported figures do not reconcile with field-verified counts for the monitoring period.',
  'Staff Absenteeism': 'Assigned facility staff absent during two consecutive scheduled monitoring visits.',
  'Equipment Malfunction': 'Cold-chain refrigeration unit recorded temperature excursions outside safe range.',
  'Environmental Hazard': 'Improper disposal of waste observed near facility perimeter, risk to surrounding area.',
  'Community Grievance': 'Community leadership raised formal concern regarding facility accessibility.',
};

function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff);
  };
}

function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }

function fmtDate(d) { return d.toISOString().slice(0, 10) + ' ' + d.toISOString().slice(11, 16); }

export function generateIssues(count = 64) {
  const rand = seededRandom(42);
  const issues = [];
  const now = new Date('2026-08-05T09:00:00');

  for (let i = 0; i < count; i++) {
    const state = pick(rand, STATES);
    const lga = pick(rand, state.lgas);
    const ward = pick(rand, WARD_NAMES);
    const category = pick(rand, CATEGORIES);
    const priority = pick(rand, ['Critical', 'High', 'Medium', 'Low']);
    const tpm = pick(rand, TPMS);
    const daysAgo = Math.floor(rand() * 45);
    const reportedAt = new Date(now.getTime() - daysAgo * 86400000 - Math.floor(rand() * 20) * 3600000);

    const statusRoll = rand();
    let statusIdx;
    if (statusRoll < 0.16) statusIdx = 0;
    else if (statusRoll < 0.34) statusIdx = 1;
    else if (statusRoll < 0.58) statusIdx = 2;
    else if (statusRoll < 0.8) statusIdx = 3;
    else statusIdx = 4;
    const status = STATUS_ORDER[statusIdx];

    const dri = statusIdx >= 1 ? pick(rand, DRIS) : null;
    const history = [
      { date: fmtDate(reportedAt), actor: tpm.name, action: 'Issue reported', note: 'Field visit finding logged with photo evidence and GPS capture.' },
    ];
    let cursor = new Date(reportedAt.getTime() + (4 + Math.floor(rand() * 20)) * 3600000);
    if (statusIdx >= 1) {
      history.push({ date: fmtDate(cursor), actor: 'TPM Sub-Panel', action: 'Assigned to DRI', note: `Routed to ${dri.name} (${dri.title}) for action.` });
      cursor = new Date(cursor.getTime() + (12 + Math.floor(rand() * 48)) * 3600000);
    }
    if (statusIdx >= 2) {
      history.push({ date: fmtDate(cursor), actor: dri.name, action: 'Response submitted', note: 'DRI acknowledged issue and began corrective steps.' });
      cursor = new Date(cursor.getTime() + (24 + Math.floor(rand() * 72)) * 3600000);
    }
    if (statusIdx >= 3) {
      history.push({ date: fmtDate(cursor), actor: dri.name, action: 'Corrective action recorded', note: 'Remedial action completed and evidence submitted for review.' });
      cursor = new Date(cursor.getTime() + (12 + Math.floor(rand() * 48)) * 3600000);
    }
    if (statusIdx >= 4) {
      history.push({ date: fmtDate(cursor), actor: tpm.name, action: 'Verified and closed', note: 'TPM confirmed resolution during follow-up visit.' });
    }

    issues.push({
      id: `ISS-${1000 + i}`,
      category,
      description: DESCRIPTIONS[category],
      state: state.name,
      lga,
      ward,
      mapX: Math.min(96, Math.max(4, state.x + (rand() * 10 - 5))),
      mapY: Math.min(96, Math.max(4, state.y + (rand() * 10 - 5))),
      lat: (4.5 + rand() * 9).toFixed(4),
      lng: (3 + rand() * 11).toFixed(4),
      reportedAt: fmtDate(reportedAt),
      reportedBy: tpm.name,
      tpmId: tpm.id,
      priority,
      status,
      assignedDRI: dri ? dri.name : null,
      driId: dri ? dri.id : null,
      driResponse: statusIdx >= 2 ? 'Acknowledged the finding; corrective steps initiated within 48 hours per SOP.' : null,
      correctiveAction: statusIdx >= 3 ? 'Replacement part sourced and installed; facility staff briefed on interim mitigation.' : null,
      verifiedBy: statusIdx >= 4 ? tpm.name : null,
      resolutionDate: statusIdx >= 4 ? fmtDate(cursor) : null,
      photoCount: 1 + Math.floor(rand() * 4),
      history,
    });
  }
  return issues.sort((a, b) => (a.reportedAt < b.reportedAt ? 1 : -1));
}
