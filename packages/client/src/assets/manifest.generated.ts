/* Generated from assets/manifest.json by `pnpm manifest-types`. Do not edit. */

export type AssetId = 'creep_runner_t1' | 'creep_runner_t2' | 'creep_runner_t3' | 'creep_swarm_t1' | 'creep_swarm_t2' | 'creep_swarm_t3' | 'creep_tank_t1' | 'creep_tank_t2' | 'creep_tank_t3' | 'fx_hit_single' | 'fx_hit_slow' | 'fx_hit_splash' | 'proj_bolt' | 'proj_orb' | 'proj_shell' | 'tile_blocked' | 'tile_cursor' | 'tile_entrance' | 'tile_exit' | 'tile_leak' | 'tile_normal' | 'tower_single_l1' | 'tower_single_l2' | 'tower_single_l3' | 'tower_slow_l1' | 'tower_slow_l2' | 'tower_slow_l3' | 'tower_splash_l1' | 'tower_splash_l2' | 'tower_splash_l3'
export type SoundId = 'sfx_build_single_1' | 'sfx_build_slow_1' | 'sfx_build_splash_1' | 'sfx_click_1' | 'sfx_death_large_1' | 'sfx_death_large_2' | 'sfx_death_large_3' | 'sfx_death_medium_1' | 'sfx_death_medium_2' | 'sfx_death_medium_3' | 'sfx_death_small_1' | 'sfx_death_small_2' | 'sfx_death_small_3' | 'sfx_hit_single_1' | 'sfx_hit_single_2' | 'sfx_hit_single_3' | 'sfx_hit_slow_1' | 'sfx_hit_slow_2' | 'sfx_hit_splash_1' | 'sfx_hit_splash_2' | 'sfx_income_1' | 'sfx_leak_mine_1' | 'sfx_leak_theirs_1' | 'sfx_match_lost_1' | 'sfx_match_won_1' | 'sfx_refused_1' | 'sfx_respawn_1' | 'sfx_select_1' | 'sfx_sell_1' | 'sfx_send_1' | 'sfx_shot_single_1' | 'sfx_shot_single_2' | 'sfx_shot_single_3' | 'sfx_shot_slow_1' | 'sfx_shot_slow_2' | 'sfx_shot_slow_3' | 'sfx_shot_splash_1' | 'sfx_shot_splash_2' | 'sfx_shot_splash_3' | 'sfx_spawn_large_1' | 'sfx_spawn_large_2' | 'sfx_spawn_medium_1' | 'sfx_spawn_medium_2' | 'sfx_spawn_small_1' | 'sfx_spawn_small_2' | 'sfx_tier_unlock_1' | 'sfx_upgrade_1'
export type ClipName = 'Idle' | 'Walk' | 'Death' | 'Spawn' | 'Build' | 'Attack' | 'Upgrade' | 'Sell'

export const ASSET_IDS: readonly AssetId[] = ['creep_runner_t1', 'creep_runner_t2', 'creep_runner_t3', 'creep_swarm_t1', 'creep_swarm_t2', 'creep_swarm_t3', 'creep_tank_t1', 'creep_tank_t2', 'creep_tank_t3', 'fx_hit_single', 'fx_hit_slow', 'fx_hit_splash', 'proj_bolt', 'proj_orb', 'proj_shell', 'tile_blocked', 'tile_cursor', 'tile_entrance', 'tile_exit', 'tile_leak', 'tile_normal', 'tower_single_l1', 'tower_single_l2', 'tower_single_l3', 'tower_slow_l1', 'tower_slow_l2', 'tower_slow_l3', 'tower_splash_l1', 'tower_splash_l2', 'tower_splash_l3']
export const SOUND_IDS: readonly SoundId[] = ['sfx_build_single_1', 'sfx_build_slow_1', 'sfx_build_splash_1', 'sfx_click_1', 'sfx_death_large_1', 'sfx_death_large_2', 'sfx_death_large_3', 'sfx_death_medium_1', 'sfx_death_medium_2', 'sfx_death_medium_3', 'sfx_death_small_1', 'sfx_death_small_2', 'sfx_death_small_3', 'sfx_hit_single_1', 'sfx_hit_single_2', 'sfx_hit_single_3', 'sfx_hit_slow_1', 'sfx_hit_slow_2', 'sfx_hit_splash_1', 'sfx_hit_splash_2', 'sfx_income_1', 'sfx_leak_mine_1', 'sfx_leak_theirs_1', 'sfx_match_lost_1', 'sfx_match_won_1', 'sfx_refused_1', 'sfx_respawn_1', 'sfx_select_1', 'sfx_sell_1', 'sfx_send_1', 'sfx_shot_single_1', 'sfx_shot_single_2', 'sfx_shot_single_3', 'sfx_shot_slow_1', 'sfx_shot_slow_2', 'sfx_shot_slow_3', 'sfx_shot_splash_1', 'sfx_shot_splash_2', 'sfx_shot_splash_3', 'sfx_spawn_large_1', 'sfx_spawn_large_2', 'sfx_spawn_medium_1', 'sfx_spawn_medium_2', 'sfx_spawn_small_1', 'sfx_spawn_small_2', 'sfx_tier_unlock_1', 'sfx_upgrade_1']

/** Ids by class, for preloading a match and for the dev viewer. */
export const ASSETS_BY_CLASS: Readonly<Record<string, readonly AssetId[]>> = {
  'creep': [
    'creep_runner_t1',
    'creep_runner_t2',
    'creep_runner_t3',
    'creep_swarm_t1',
    'creep_swarm_t2',
    'creep_swarm_t3',
    'creep_tank_t1',
    'creep_tank_t2',
    'creep_tank_t3'
  ],
  'effect': [
    'fx_hit_single',
    'fx_hit_slow',
    'fx_hit_splash'
  ],
  'projectile': [
    'proj_bolt',
    'proj_orb',
    'proj_shell'
  ],
  'tile': [
    'tile_blocked',
    'tile_cursor',
    'tile_entrance',
    'tile_exit',
    'tile_leak',
    'tile_normal'
  ],
  'tower': [
    'tower_single_l1',
    'tower_single_l2',
    'tower_single_l3',
    'tower_slow_l1',
    'tower_slow_l2',
    'tower_slow_l3',
    'tower_splash_l1',
    'tower_splash_l2',
    'tower_splash_l3'
  ]
}

/** Manifest version this file was generated from; the registry refuses a manifest that disagrees. */
export const MANIFEST_VERSION = 1
export const MANIFEST_ASSET_COUNT = 30
export const MANIFEST_SOUND_COUNT = 47
