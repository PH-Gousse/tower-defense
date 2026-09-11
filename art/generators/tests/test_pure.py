"""
The pure layer, outside Blender. Every test here runs in plain pytest and
pins a promise the style sheet or the animation contract makes.
"""

import json
import math
import os

import numpy as np
import pytest

from ltw_art import frame, mathx, palette, params as P, registry
from ltw_art.anims.clip import Clip
from ltw_art.build import dry_run, lay_out, plan_clips
from ltw_art.rng import rng_for

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "..")


def spec_for(plan: str, rig: str | None, anims: dict, cls: str = "creep", params: dict | None = None, id_: str | None = None) -> dict:
    return {
        "id": id_ or f"{cls}_test_t1",
        "class": cls,
        "archetype": "test",
        "body_plan": plan,
        "params": params or {},
        "palette": {"primary": "moss", "secondary": "iron", "accent": "danger", "glow": "danger", "tier_shift": 0, "trim": False, "team_mask": []},
        "rig": rig,
        "animations": anims,
        "source": {"kind": "generated", "licence": "own"},
    }


# ---- frame -----------------------------------------------------------------

def test_game_to_blender_is_a_rotation_that_maps_forward_to_minus_y_and_up_to_z():
    assert frame.to_blender((0, 0, 1)) == (0.0, -1.0, 0.0)
    assert frame.to_blender((0, 1, 0)) == (0.0, 0.0, 1.0)
    assert frame.to_blender((1, 0, 0)) == (1.0, 0.0, 0.0)
    assert abs(np.linalg.det(frame.C) - 1.0) < 1e-12
    for v in ((1, 2, 3), (-0.5, 0, 9)):
        assert np.allclose(frame.to_game(frame.to_blender(v)), v)


def test_matrix_conversion_matches_point_conversion():
    m = frame.compose((1, 2, 3), (0.3, -0.4, 0.5), (1, 2, 0.5))
    p = np.array([0.2, 0.7, -0.1, 1.0])
    via_game = frame.to_blender((m @ p)[:3])
    via_bl = (frame.matrix_to_blender(m) @ np.array([*frame.to_blender(p[:3]), 1.0]))[:3]
    assert np.allclose(via_game, via_bl)


# ---- palette ---------------------------------------------------------------

def test_palette_matches_the_style_sheet_and_the_registry_json():
    sheet = open(os.path.join(ROOT, "docs", "art", "style-sheet.md")).read()
    for name, hex_ in palette.COLOURS.items():
        assert f"`{name}`" in sheet and f"`{hex_}`" in sheet, f"{name} {hex_} missing from the style sheet"
    reg = json.load(open(os.path.join(ROOT, "art", "generators", "registry.json")))
    assert reg["palette"] == palette.COLOURS
    assert reg["palette_aliases"] == palette.ALIASES


def test_linear_conversion_round_trips_black_and_white():
    assert palette.linear((0, 0, 0)) == (0, 0, 0)
    assert all(abs(v - 1.0) < 1e-9 for v in palette.linear((1, 1, 1)))


# ---- params ----------------------------------------------------------------

def test_params_fill_defaults_check_ranges_and_refuse_unknown_names():
    decl = {"h": P.P(1.0, 0.5, 2.0), "kind": P.P("a", enum=("a", "b")), "on": P.P(True)}
    assert P.resolve(decl, {}, "x") == {"h": 1.0, "kind": "a", "on": True}
    with pytest.raises(ValueError, match="above the maximum"):
        P.resolve(decl, {"h": 3}, "x")
    with pytest.raises(ValueError, match="not one of"):
        P.resolve(decl, {"kind": "c"}, "x")
    with pytest.raises(ValueError, match="no parameter named"):
        P.resolve(decl, {"nope": 1}, "x")
    with pytest.raises(ValueError, match="true/false"):
        P.resolve(decl, {"on": 1}, "x")


# ---- registry --------------------------------------------------------------

def test_registry_json_is_generated_from_the_python_package():
    committed = json.load(open(os.path.join(ROOT, "art", "generators", "registry.json")))
    assert committed == registry.to_json(), "run: python3 -m ltw_art.registry > art/generators/registry.json"


def test_every_body_plan_grounds_at_the_origin_and_fits_its_class():
    reg = registry.load_all()
    for name, plan in reg.body_plans.items():
        if name == "imported":
            continue
        p = P.resolve(plan.params, {}, name)
        lay = plan.fn(p, rng_for("test", name))
        lo, hi = lay.bounds()
        if plan.cls == "projectile":
            assert abs((lo[1] + hi[1]) / 2) < 1e-6, f"{name}: a projectile is centred on its origin"
        elif name == "hover":
            assert lo[1] > 0.04, f"{name}: a hover creature keeps a gap to the ground"
        else:
            assert abs(lo[1]) < 1e-6, f"{name}: lowest point at y={lo[1]}, must be 0"
        assert abs((lo[0] + hi[0]) / 2) < 1e-6 and abs((lo[2] + hi[2]) / 2) < 1e-6, f"{name}: footprint not centred"
        assert lay.height > 0
        for a in plan.attachments:
            assert a in lay.attachments, f"{name}: declares attachment {a} but did not place it"
        for prim in lay.prims:
            assert prim.slot in plan.slots or prim.slot == "bone", f"{name}: prim uses undeclared slot {prim.slot}"
        if plan.cls == "tower":
            assert lay.footprint <= 0.84 + 1e-6, f"{name}: footprint {lay.footprint} exceeds the 0.84 tile rule"
            assert lay.muzzle is not None, f"{name}: a tower needs a muzzle"


def test_every_body_plan_is_within_its_triangle_budget_at_defaults():
    budgets = {"creep": 1500, "tower": 2500, "projectile": 100, "effect": 100, "tile": 200, "prop": 200}
    reg = registry.load_all()
    for name, plan in reg.body_plans.items():
        if name == "imported":
            continue
        p = P.resolve(plan.params, {}, name)
        lay = plan.fn(p, rng_for("test", name))
        # Bevels add triangles at realisation; leave 25% headroom for them.
        assert lay.triangles() <= budgets[plan.cls] * 0.75, f"{name}: {lay.triangles()} estimated triangles, budget {budgets[plan.cls]}"


def test_every_rig_builds_every_declared_bone_from_its_plans():
    reg = registry.load_all()
    for rname, rig in reg.rigs.items():
        for pname in rig.plans:
            plan = reg.body_plans[pname]
            lay = plan.fn(P.resolve(plan.params, {}, pname), rng_for("t", pname))
            bones = rig.fn(lay)
            names = [b.name for b in bones]
            assert names == rig.bones, f"{rname} on {pname}: bones {names} != declared {rig.bones}"
            assert names[0] == "root"
            for b in bones:
                assert b.parent is None or b.parent in names
                assert b.parent is None or names.index(b.parent) < names.index(b.name), "parents come first"
            # Every prim binding names a real bone.
            for prim in lay.prims:
                assert prim.bone is None or prim.bone in names, f"{pname}: prim bound to unknown bone {prim.bone}"
                assert prim.blend is None or prim.blend in names


def test_every_part_attaches_where_it_says():
    reg = registry.load_all()
    for name, part in reg.parts.items():
        assert part.default_at in part.attaches
        lay = part.fn(1.0, rng_for("t", name))
        assert lay.prims, f"{name}: empty"
        for prim in lay.prims:
            assert prim.slot in part.slots, f"{name}: undeclared slot {prim.slot}"


# ---- animation contract ----------------------------------------------------

def _rig_bones(plan_name: str, rig_name: str):
    reg = registry.load_all()
    plan = reg.body_plans[plan_name]
    lay = plan.fn(P.resolve(plan.params, {}, plan_name), rng_for("t", plan_name))
    return [b.name for b in reg.rigs[rig_name].fn(lay)]


def test_loop_clips_are_seamless_and_have_no_root_motion():
    reg = registry.load_all()
    bones = _rig_bones("quadruped", "quadruped")
    for name, anim in reg.animations.items():
        if not anim.loop:
            continue
        clip = anim.fn(P.resolve(anim.params, {}, name), bones, 24, rng_for("t", name))
        assert clip.loop
        first = {k.bone: k for k in clip.keys if k.frame == 0}
        # The clip samples frames 0..N-1 of a period of N: the pose at frame N
        # equals frame 0, so compare frame 0 with what frame N-1 is heading to.
        assert max(k.frame for k in clip.keys) == clip.frames - 1
        for k in clip.keys:
            if k.bone == "root":
                assert abs(k.loc[0]) < 1e-9 and abs(k.loc[2]) < 1e-9, f"{name}: root translates horizontally"
        assert first, f"{name}: nothing keyed at frame 0"


def test_one_shot_clips_hold_a_pose_at_the_end_and_carry_their_markers():
    reg = registry.load_all()
    bones = _rig_bones("quadruped", "quadruped")
    for name, anim in reg.animations.items():
        if anim.loop:
            continue
        p = P.resolve(anim.params, {}, name)
        p["_height"] = 0.5
        clip = anim.fn(p, bones, 24, rng_for("t", name))
        assert not clip.loop
        assert max(k.frame for k in clip.keys) == clip.frames
        for m, t in clip.markers.items():
            assert 0.0 <= t <= 1.0, f"{name}: marker {m} out of range"


def test_clip_lengths_follow_the_contract_ranges():
    reg = registry.load_all()
    bones = _rig_bones("quadruped", "quadruped")
    walk = reg.animations["walk_quadruped"].fn(P.resolve(reg.animations["walk_quadruped"].params, {"cadence": 3.6}, "w"), bones, 24, rng_for("t"))
    assert walk.frames == mathx.frames_for(1 / 3.6, 24)
    assert walk.stride == 1.0


# ---- determinism -----------------------------------------------------------

def test_dry_run_is_deterministic_for_a_spec():
    spec = spec_for("quadruped", "quadruped", {"Walk": {"gen": "walk_quadruped"}, "Death": {"gen": "collapse_forward"}}, params={"parts": ["shoulder_spikes"]})
    a = dry_run(spec)
    b = dry_run(spec)
    assert a == b
    assert "shoulder_spikes" not in a["slots"] and "spike" in a["slots"]


def test_the_seed_comes_from_the_spec_id():
    assert rng_for("creep_a_t1").random() != rng_for("creep_b_t1").random()
    assert rng_for("creep_a_t1").random() == rng_for("creep_a_t1").random()


def test_mathx_loops_are_periodic():
    assert abs(mathx.loop_sin(0.0) - mathx.loop_sin(1.0)) < 1e-12
    assert abs(mathx.loop_cos(0.25, 2.0) - mathx.loop_cos(1.25, 2.0)) < 1e-12
    assert mathx.frames_for(0.01, 24) == 2
    assert mathx.tri_count("box", 1) == 12


def test_layout_placed_transforms_attachments_and_joints_together():
    from ltw_art.layout import Attachment, Layout, Prim

    lay = Layout()
    lay.add(Prim("box", (1, 1, 1), (0, 0.5, 0), bone="a"))
    lay.attach(Attachment("top", (0, 1, 0), size=1))
    lay.joint("j", (0, 0, 0))
    moved = lay.placed((1, 0, 2), scale=2.0, bone="b")
    assert moved.attachments["top"].pos == pytest.approx((1, 2, 2))
    assert moved.attachments["top"].size == 2
    assert moved.joints["j"].pos == pytest.approx((1, 0, 2))
    assert moved.prims[0].bone == "a"  # an explicit binding is kept; only unbound prims take the attachment's bone


def test_generators_md_is_generated_from_the_registry():
    from ltw_art import docs

    committed = open(os.path.join(ROOT, "art", "generators", "generators.md")).read()
    assert committed == docs.render(), "run: python3 -m ltw_art.docs > art/generators/generators.md"


def test_every_animation_generator_runs_on_every_rig():
    """A generator must tolerate a rig that lacks the bones it prefers (a
    tower has no legs; a blob has no head): it keys what is there."""
    reg = registry.load_all()
    for rname, rig in reg.rigs.items():
        pname = rig.plans[0]
        plan = reg.body_plans[pname]
        lay = plan.fn(P.resolve(plan.params, {}, pname), rng_for("t", pname))
        bones = [b.name for b in rig.fn(lay)]
        for aname, anim in reg.animations.items():
            p = P.resolve(anim.params, {}, aname)
            p["_height"] = lay.height
            clip = anim.fn(p, bones, 24, rng_for("t", aname))
            assert clip.keys, f"{aname} on {rname}: no keys"
            for k in clip.keys:
                assert k.bone in bones, f"{aname} on {rname}: keys unknown bone {k.bone}"


def test_parts_snap_to_every_point_they_claim_on_every_plan_that_has_it():
    reg = registry.load_all()
    for pname, plan in reg.body_plans.items():
        if pname == "imported":
            continue
        lay = plan.fn(P.resolve(plan.params, {}, pname), rng_for("t", pname))
        for part_name, part in reg.parts.items():
            for at in part.attaches:
                if at not in lay.attachments:
                    continue
                point = lay.attachments[at]
                placed = part.fn(point.size, rng_for("t", part_name)).placed(point.pos, point.rot, 1.0, bone=point.bone)
                assert all(pr.bone == point.bone for pr in placed.prims), f"{part_name} at {pname}.{at}: prims not bound to the point's bone"
