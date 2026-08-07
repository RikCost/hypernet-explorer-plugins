//=============================================================================
// Weapon 3D Models - Flails (the <Flail> rope subtype)
// Version: 1.0.0
//=============================================================================

/*:
 * @target MZ
 * @plugindesc Procedural 3D models for flails (the <flail> rope subtype). Loaded
 * automatically by WeaponSystemProcedural.js.
 * @author AntiGravity
 *
 * @help
 * ============================================================================
 * Weapon 3D Models - Flails (the <Flail> rope subtype)
 * ============================================================================
 *
 * One family per weapon type. This one owns every weapon carrying the <Flail> tag:
 * the generic silhouette the type falls back to, the note-tagged one-offs of
 * that type, and every bespoke per-weapon model in it.
 *
 * NOT listed in plugins.js. WeaponSystemProcedural.js injects this file at
 * runtime from its WEAPON3D_FAMILIES list, the same way 3DBattlerSystem.js
 * loads its 3DBattler_* families. Adding a model means adding a builder here
 * and, for a bespoke one, its database id to the unique map below.
 *
 * Every builder takes (weapon, rand) where rand is a seeded RNG derived from
 * the world's history seed, and returns a THREE.Group whose grip sits below
 * the origin with the weapon running along +Y. Shared construction helpers
 * (_plate, _bladeOutline, _hilt, _crossguard, _rivets, seg, wantsTrim, the
 * colour palettes and the material shorthands) live on WeaponSystemProcedural
 * itself, so they are available as `this` inside a builder.
 * ============================================================================
 */

(() => {
  'use strict';
  if (!window.WeaponSystemProcedural) {
    console.error('[Weapon3D_Flails] WeaponSystemProcedural not loaded');
    return;
  }

  window.WeaponSystemProcedural.registerFamily({
    name: 'Weapon3D_Flails',
    models: {
      // Special <Flail> support (linked chain segments with physics)
      createFlailModel(weapon, rand) {
        const group = new THREE.Group();
        const handleColor = this.getRandomColor(rand, this.handleColors);
        const metalColor = this.getRandomColor(rand, this.guardColors);
        const wrapColor = this.getRandomColor(rand, this.handleColors.filter(c => c !== handleColor));
        const gemColor = this.getRandomColor(rand, this.crystalColors);

        const woodMat = new THREE.MeshStandardMaterial({ color: handleColor, roughness: 0.9 });
        const wrapMat = new THREE.MeshStandardMaterial({ color: wrapColor, roughness: 0.95 });
        const metalMat = new THREE.MeshStandardMaterial({ color: metalColor, roughness: 0.35, metalness: 0.75 });
        const gemMat = new THREE.MeshStandardMaterial({ color: gemColor, roughness: 0.1, emissive: gemColor, emissiveIntensity: 0.7 });

        // Handle
        const hHeight = 0.2 + rand() * 0.1;
        const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, hHeight, 8), woodMat);
        h.position.y = -hHeight / 2;
        group.add(h);

        // Grip wraps
        this.addGripWrap(h, rand, hHeight, 0.02, 0.016, wrapMat);

        // Lanyard ring pommel
        const lanyard = new THREE.Mesh(new THREE.TorusGeometry(0.015, 0.004, 4, 8), metalMat);
        lanyard.position.y = -hHeight;
        lanyard.rotation.x = Math.PI / 2;
        group.add(lanyard);

        // ---- Linked-chain physics for all flail variants ----
        const flailStyle = Math.floor(rand() * 3);
        const numSegments = weapon.segments || 8;
        const chainLength = 0.2 + rand() * 0.15;
        const linkSpacing = chainLength / numSegments;

        // Helper: build a physics-driven chain and return its rope
        const buildPhysicsChain = (parentGroup, segCount, anchorOffset, scaleFactor = 1.0, endMassVal = 3.0) => {
          const anchor = new THREE.Vector3(anchorOffset.x, anchorOffset.y, anchorOffset.z);
          const sLen = linkSpacing * scaleFactor;

          const rope = this.createVerletRope(segCount + 1, sLen, anchor, {
            gravity: -0.0008,
            damping: 0.93,
            iterations: 8,
            stiffness: 1.0,
            endMass: endMassVal
          });

          const linkRadius = 0.015 * scaleFactor;
          const linkTube = 0.004 * scaleFactor;

          for (let i = 0; i < segCount; i++) {
            const linkGeo = new THREE.TorusGeometry(linkRadius, linkTube, 4, 8);
            const link = new THREE.Mesh(linkGeo, metalMat);
            // Alternate link rotation for interlocking chain look
            link.userData._chainAlternate = (i % 2 === 0);
            link.position.set(anchor.x, anchor.y + sLen * i + sLen / 2, anchor.z);
            parentGroup.add(link);
            rope.segmentMeshes.push(link);
          }

          return rope;
        };

        // Helper: create spiky ball head group
        const buildSpikyBallGroup = (radius, spikeSize = 1.0) => {
          const headGroup = new THREE.Group();
          const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 12), metalMat);
          headGroup.add(ball);

          const spikeRadius = 0.008 * spikeSize;
          const spikeHeight = 0.018 * spikeSize;
          const spikeGeo = new THREE.ConeGeometry(spikeRadius, spikeHeight, 4);
          const numSpikes = 8 + Math.floor(rand() * 6);

          for (let i = 0; i < numSpikes; i++) {
            const spike = new THREE.Mesh(spikeGeo, metalMat);
            const phi = Math.acos(-1 + (2 * i) / numSpikes);
            const theta = Math.sqrt(numSpikes * Math.PI) * phi;

            spike.position.set(
              radius * Math.sin(phi) * Math.cos(theta),
              radius * Math.sin(phi) * Math.sin(theta),
              radius * Math.cos(phi)
            );

            const normal = spike.position.clone().normalize();
            spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
            ball.add(spike);
          }
          return headGroup;
        };

        // Store all ropes for this flail (multi-headed has 3)
        const ropes = [];

        if (flailStyle === 0) {
          // 1. Classic Spiky morningstar flail, single heavy chain
          const rope = buildPhysicsChain(group, numSegments, new THREE.Vector3(0, 0, 0), 1.0, 4.0);
          const ballRadius = 0.045 + rand() * 0.015;
          const headGroup = buildSpikyBallGroup(ballRadius, 1.0);
          headGroup.position.set(0, linkSpacing * numSegments, 0);
          group.add(headGroup);
          rope.headMeshGroup = headGroup;
          ropes.push(rope);

        } else if (flailStyle === 1) {
          // 2. Multi-headed flail (3 independent physics chains branching off hilt)
          const angles = [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3];
          for (let i = 0; i < 3; i++) {
            const spreadX = Math.cos(angles[i]) * 0.015;
            const spreadZ = Math.sin(angles[i]) * 0.015;
            const anchorOff = new THREE.Vector3(spreadX, 0, spreadZ);

            const rope = buildPhysicsChain(group, 5, anchorOff, 0.7, 2.5);
            const headGroup = buildSpikyBallGroup(0.025, 0.6);
            headGroup.position.set(spreadX, linkSpacing * 5 * 0.7, spreadZ);
            group.add(headGroup);
            rope.headMeshGroup = headGroup;
            ropes.push(rope);
          }

        } else {
          // 3. Meteor Hammer, heavy glowing runic urn weight
          const rope = buildPhysicsChain(group, numSegments, new THREE.Vector3(0, 0, 0), 1.0, 5.0);

          const headGroup = new THREE.Group();
          // Polyhedron urn block
          const urnGeo = new THREE.IcosahedronGeometry(0.042, 0);
          const urn = new THREE.Mesh(urnGeo, metalMat);
          headGroup.add(urn);

          // Embedded core magical gem glowing
          const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.024, 0), gemMat);
          headGroup.add(gem);

          headGroup.position.set(0, linkSpacing * numSegments, 0);
          group.add(headGroup);
          rope.headMeshGroup = headGroup;
          ropes.push(rope);
        }

        // Store ropes on the group for physics ticking
        group.userData._verletRopes = ropes;

        return group;
      }
    }
  });
})();
