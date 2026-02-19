(function(global){
  const WEAPONS = {
    rifle: {
      id:'rifle', label:'Rifle', type:'hitscan',
      fireCdMs: 250, range: 30,
      dmg: 25,
      falloff: { near:5, far:30, minMult:0.55 },
      mag: 12, reloadMs: 900,
    },
    shotgun: {
      id:'shotgun', label:'Shotgun', type:'hitscan',
      fireCdMs: 650, range: 22,
      pellets: 6, spread: 0.14,
      pelletDmg: 10,
      falloff: { near:3, far:22, minMult:0.45 },
      mag: 12, reloadMs: 900,
    },
    sniper: {
      id:'sniper', label:'Sniper', type:'hitscan3d',
      fireCdMs: 1100, range: 80,
      bodyDmg: 50,
      headDmg: 999,
      mag: 12, reloadMs: 900,
    },
    fart: {
      id:'fart', label:'Fart gun', type:'status',
      fireCdMs: 450, range: 22,
      mag: 12, reloadMs: 900,
    },
    rocket: {
      id:'rocket', label:'Rocket', type:'rocket',
      fireCdMs: 1500, range: 80,
      splashR: 6,
      mag: 12, reloadMs: 900,
    },

    knife: {
      id:'knife', label:'Knife', type:'melee',
      fireCdMs: 250,
      range: 2.2,
      coneDot: 0.65,
      dmgFront: 35,
      backstabDot: -0.35,
      dmgBackstab: 999,
    },

    grenade_frag: {
      id:'grenade_frag', label:'Frag Grenade', type:'grenade',
      fireCdMs: 900,
      fuseMs: 1200,
      impact: false,
      armMs: 0,
      splashR: 6,
      dmgMax: 100,
      dmgMin: 0,
      bounce: 0.55,
    },
    grenade_impact: {
      id:'grenade_impact', label:'Impact Grenade', type:'grenade',
      fireCdMs: 900,
      fuseMs: 2500,
      impact: true,
      armMs: 180,
      splashR: 4.5,
      dmgMax: 110,
      dmgMin: 0,
      bounce: 0.35,
    },

    minigun: {
      id:'minigun', label:'Minigun', type:'minigun',
      fireCdMs: 20,        // 50 rounds/sec at full spin (3000 RPM equiv)
      rpmMin: 600,         // already spinning fast at spin-up threshold
      rpmMax: 3000,        // full-speed: 50 rounds/sec
      dmg: 7,              // lower per-shot, devastating in volume
      headMult: 1.4,
      range: 38,
      heatPerShot: 0.004,  // heats slower so you can sustain longer bursts
      coolPerSec: 0.40,
      overheatAt: 1.0,
      recoverAt: 0.25,
      spinUpPerSec: 6.0,   // spins up in ~0.2s (fast enough to feel responsive)
      spinDownPerSec: 5.0,
      ammo: 450,           // more ammo for sustained suppression
    },
  };

  function getWeapon(id){
    return WEAPONS[id] || WEAPONS.rifle;
  }

  const api = { WEAPONS, getWeapon };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.WEAPONS = api;
})(typeof window !== 'undefined' ? window : globalThis);
