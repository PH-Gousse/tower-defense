import GUI from 'lil-gui'
import type { CameraRig } from './CameraRig'

/**
 * The tuning panel, kept out of `CameraRig` on purpose.
 *
 * The rig is shipped code and must not drag lil-gui into the game bundle; this
 * module is the only thing that imports it, so a page that never calls
 * `attachCameraGui` never pays for it. Every control writes a plain property on
 * the rig -- there is no shadow copy of the parameters here, which is what
 * keeps the panel from drifting out of step with a `fitBounds` call.
 */
export function attachCameraGui(rig: CameraRig, onFit?: (mode: FitMode) => void): GUI {
  const gui = new GUI({ title: 'Camera' })

  gui.add(rig, 'pitchDeg', 20, 89, 0.5).name('pitch (deg)').listen()
  gui.add(rig, 'fovDeg', 15, 80, 0.5).name('fov (deg)').listen()
  gui.add(rig, 'yawDeg', -180, 180, 1).name('yaw (deg)').listen()
  gui.add(rig, 'distance', 5, 120, 0.5).name('distance').listen()

  const limits = gui.addFolder('zoom limits').close()
  limits.add(rig, 'minDistance', 4, 60, 0.5).name('min').listen()
  limits.add(rig, 'maxDistance', 10, 200, 0.5).name('max').listen()

  const input = gui.addFolder('input').close()
  input.add(rig, 'panSpeed', 2, 120, 1).name('pan speed')
  input.add(rig, 'zoomSpeed', 1.01, 2, 0.01).name('zoom speed')
  input.add(rig, 'edgeSize', 0, 80, 1).name('edge scroll px')

  if (onFit) {
    const framing = {
      myLane: () => onFit('lane'),
      bothLanes: () => onFit('both'),
    }
    gui.add(framing, 'myLane').name('show my lane')
    gui.add(framing, 'bothLanes').name('show both lanes')
  }

  return gui
}

export type FitMode = 'lane' | 'both'
