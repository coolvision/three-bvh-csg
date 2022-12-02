import * as THREE from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MeshBVHVisualizer } from 'three-mesh-bvh';
import * as BufferGeometryUtils from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
	Brush,
	Evaluator,
	EdgesHelper,
	TriangleSetHelper,
	logTriangleDefinitions,
	GridMaterial,
	ADDITION,
	SUBTRACTION,
	INTERSECTION,
	DIFFERENCE,
} from '..';

// import RAPIER from 'https://cdn.skypack.dev/@dimforge/rapier3d-compat';

let renderer, camera, scene, gui;
let controls, transformControls;
let brush1, brush2, brush1_w;
let resultObject, light;
let edgesHelper, trisHelper, trisHelper2;
let needsUpdate = true;
let csgEvaluator;

// physics
let world;
let brushRigidBody;
let brushCollider;

import RAPIER from '@dimforge/rapier3d-compat';
// export type Rapier = typeof RAPIER;
function getRapier() {
  return RAPIER.init().then(() => RAPIER);
}


// import('@dimforge/rapier3d-compat').then(RAPIER => {

	init();

// });

async function init() {

	// let src = "https://cdn.skypack.dev/@dimforge/rapier3d-compat";
    // import(src).then(
	// 	(RAPIER) => RAPIER.init()
	// )
      // (canvas) => console.log(canvas)

	// await RAPIER.init();

	await getRapier();

	world = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });

	brushRigidBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
	brushCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(5/2, 5/2, 0.3/2), brushRigidBody);

	let floor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2.6, 0));
	let floorCollider = world.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.1, 10), floor);


	// renderer setup
	renderer = new THREE.WebGLRenderer( { antialias: true } );
	renderer.setSize( window.innerWidth, window.innerHeight );
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;
	renderer.outputEncoding = THREE.sRGBEncoding;
	document.body.appendChild( renderer.domElement );

	renderer.setAnimationLoop( render );

	// scene setup
	scene = new THREE.Scene();

	// lights
	light = new THREE.DirectionalLight( 0xffffff, 1 );
	light.position.set( - 1, 2, 3 );
	scene.add( light, light.target );
	scene.add( new THREE.AmbientLight( 0xb0bec5, 0.1 ) );

	// camera setup
	camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 50 );
	camera.position.set( 1, 2, 4 );
	camera.far = 100;
	camera.updateProjectionMatrix();

	// controls
	controls = new OrbitControls( camera, renderer.domElement );

	transformControls = new TransformControls( camera, renderer.domElement );
	transformControls.setSize( 0.75 );
	transformControls.addEventListener( 'dragging-changed', e => {
		controls.enabled = ! e.value;
	} );
	transformControls.addEventListener( 'objectChange', () => {
		needsUpdate = true;
	} );
	scene.add( transformControls );

	// const size = 20;
	// const divisions = 10;
	// const gridHelper = new THREE.GridHelper( size, divisions );
	// gridHelper.position.y = -2.5;
	// scene.add( gridHelper );

	// bunny mesh has no UVs so skip that attribute
	csgEvaluator = new Evaluator();
	csgEvaluator.attributes = [ 'position' ];

	brush1 = new Brush( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
	brush2 = new Brush( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
	// brush2.position.set( - 0.0, 0.75, 1 );
	brush2.position.set( - 0.0, 0.75, 0 );
	brush2.scale.setScalar( 0.75 );

	brush2.geometry = new THREE.BoxGeometry( 0.5, 0.5, 1 );
	// brush2.geometry = new THREE.ConeGeometry( 0.5, 1, 16 );
	// brush2.rotation.x = Math.PI/2;
	// brush2.position.z = -0.3;

	brush1.geometry = new THREE.BoxGeometry( 5, 5, 0.3 );

	// initialize materials
	brush1.material.opacity = 0.15;
	brush1.material.transparent = true;
	brush1.material.side = THREE.DoubleSide;

	brush2.material.opacity = 0.15;
	brush2.material.transparent = true;
	brush2.material.side = THREE.DoubleSide;
	brush2.material.wireframe = true;
	brush2.material.color.set( 0xE91E63 ).convertSRGBToLinear();

	brush1_w = new Brush( new THREE.BoxGeometry(), new THREE.MeshBasicMaterial() );
	brush1_w.material.opacity = 0.15;
	brush1_w.material.transparent = true;
	brush1_w.material.side = THREE.DoubleSide;
	brush1_w.material.wireframe = true;
	scene.add( brush1_w );

	transformControls.attach( brush2 );

	scene.add( brush1, brush2 );

	// add object displaying the result
	resultObject = new THREE.Mesh( new THREE.BufferGeometry(), new THREE.MeshBasicMaterial() );

	// helpers
	edgesHelper = new EdgesHelper();
	edgesHelper.color.set( 0xE91E63 ).convertSRGBToLinear();
	scene.add( edgesHelper );

	trisHelper = new TriangleSetHelper();
	trisHelper.color.set( 0x00BCD4 ).convertSRGBToLinear();
	scene.add( trisHelper );

	trisHelper2 = new TriangleSetHelper();
	trisHelper2.color.set( 0xD4BC00 ).convertSRGBToLinear();
	scene.add( trisHelper2 );
}

function render() {

	world.step();
	let position = brushRigidBody.translation();

	// if (brush1.position.clone().sub(position).length() > 0.01) {
	// 	needsUpdate = true;
	// }

	// brush1.position.set(position.x, position.y, position.z);
	// brush1_w.position.set(position.x, position.y, position.z);
	// console.log("position", brush1.position);

	brush1.updateMatrixWorld(true);
	brush1_w.updateMatrixWorld(true);
	brush2.updateMatrixWorld(true);

	for (let i = 0; i < scene.children.length; i++) {
		if (scene.children[i].type == "Mesh" &&
			!scene.children[i].isBrush &&
			scene.children[i].hasOwnProperty("rigidBody")) {

			let position = scene.children[i].rigidBody.translation();
			scene.children[i].position.set(position.x, position.y, position.z);

			let rotation = scene.children[i].rigidBody.rotation();
			scene.children[i].setRotationFromQuaternion(
				new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));

			scene.children[i].updateMatrixWorld(true);
		}
	}

	if ( needsUpdate ) {

		needsUpdate = false;

		// brush1.position.set(0, 0, 0);
		// brush1_w.position.set(0, 0, 0);

		console.log("init", brush1.clone());

		const startTime = window.performance.now();
		csgEvaluator.debug.enabled = true;
		csgEvaluator.useGroups = true;
		csgEvaluator.evaluate( brush1, brush2, SUBTRACTION, resultObject );

		// let check_geom = resultObject.geometry.clone();
		// check_geom.attributes.position.array.slice(check_geom.drawRange.start*3, check_geom.drawRange.count*3);
		// check_geom.attributes.position.count = check_geom.drawRange.count;
		// brush1.geometry = check_geom;
		// brush1_w.geometry = check_geom;
		// console.log("check_geom", brush1.clone());

		let check_geom = resultObject.geometry.clone();
		check_geom.attributes.position.array.slice(check_geom.drawRange.start*3, check_geom.drawRange.count*3);
		check_geom.attributes.position.count = check_geom.drawRange.count;

		check_geom.deleteAttribute('normal');
		check_geom.deleteAttribute('uv');
		check_geom = BufferGeometryUtils.mergeVertices(check_geom, 1e-5);

		let new_geoms = split_mesh_islands(check_geom);

		let largest_component_size = -1;
		let largest_component_i = -1;
		for (let i = 0; i < new_geoms.length; i++) {
 			new_geoms[i].computeBoundingBox();
			console.log("new_geoms[i].boundingBox", new_geoms[i].boundingBox);
			let size = new_geoms[i].boundingBox.max.sub(new_geoms[i].boundingBox.min);
			console.log("size", size, i);
			if (size.x + size.y + size.z > largest_component_size) {
				largest_component_size = size.x + size.y + size.z;
				largest_component_i = i;
			}
		}
		console.log("new_geoms", new_geoms)


		for (let i = 0; i < new_geoms.length; i++) {
			if (i == largest_component_i) {
				brush1.geometry = new_geoms[i];
				brush1_w.geometry = new_geoms[i];

				// update collider after mesh modification
				let newColliderDesc = RAPIER.ColliderDesc.convexHull(brush1.geometry.attributes.position.array)
				world.removeCollider(brushCollider)
				brushCollider = world.createCollider(newColliderDesc, brushRigidBody);

			} else {
				const color = new THREE.Color();
				color.setRGB(
					Math.random(),
					Math.random(),
					Math.random(),
				);
				const material = new THREE.MeshBasicMaterial( {
					color: color,
					side: THREE.DoubleSide,
					opacity: 0.15,
					transparent: true,
				} );
				let new_mesh = new THREE.Mesh(new_geoms[i], material);

				let newRigidBody = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
				let newColliderDesc = RAPIER.ColliderDesc.convexHull(new_geoms[i].attributes.position.array)
				world.createCollider(newColliderDesc, newRigidBody);
				new_mesh.rigidBody = newRigidBody;

				scene.add(new_mesh);
				new_mesh.position.copy(brush1.position);
			}
		}

		// edgesHelper.setEdges( csgEvaluator.debug.intersectionEdges );
		// trisHelper.setTriangles( [
		// 	...csgEvaluator.debug.triangleIntersectsA.getTrianglesAsArray(),
		// 	...csgEvaluator.debug.triangleIntersectsA.getIntersectionsAsArray()
		// ] );
		// trisHelper2.setTriangles( [
		// 	...csgEvaluator.debug.triangleIntersectsB.getTrianglesAsArray(),
		// 	...csgEvaluator.debug.triangleIntersectsB.getIntersectionsAsArray()
		// ] );
	}

	renderer.render( scene, camera );
}


function find(parents, x) {
	if (typeof parents[x] != "undefined") {
		if (parents[x] < 0) {
			return x; //x is a parent
		} else {
			//recurse until you find x's parent
			return find(parents, parents[x]);
		}
	} else {
		// initialize this node to it's on parent (-1)
		parents[x] = -1;
		// console.log("init", x)
		return x; //return the index of the parent
	}
}

function union(parents, x, y) {
	var xpar = find(parents, x);
	var ypar = find(parents, y);
	if (xpar != ypar) {
		// x's parent is now the parent of y also.
		// if y was a parent to more than one node, then
		// all of those nodes are now also connected to x's parent.
		parents[xpar] += parents[ypar];
		parents[ypar] = xpar;
		return false;
	} else {
		return true; //this link creates a cycle
	}
}

const EPSILON$1 = 1e-8;
const _tmp1 = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
function isTriDegenerate(tri) {
	_tmp1.subVectors(tri.a, tri.b);
	_tmp2.subVectors(tri.a, tri.c);
	_tmp1.cross(_tmp2);
	return _tmp1.x > -EPSILON$1 && _tmp1.x < EPSILON$1 &&
		_tmp1.y > -EPSILON$1 && _tmp1.y < EPSILON$1 &&
		_tmp1.z > -EPSILON$1 && _tmp1.z < EPSILON$1;
}

function split_mesh_islands(check_geom) {

	let parents = [];
	let new_geoms = [];

	for (let i = 0; i < check_geom.index.array.length; i+=3) {
		let v_index = [check_geom.index.array[i],
					   check_geom.index.array[i+1],
					   check_geom.index.array[i+2]];
		let tri = new THREE.Triangle();
		tri.a.fromBufferAttribute(check_geom.attributes.position, v_index[0]);
		tri.b.fromBufferAttribute(check_geom.attributes.position, v_index[1]);
		tri.c.fromBufferAttribute(check_geom.attributes.position, v_index[2]);
		if (isTriDegenerate(tri)) {
			console.warn("isTriDegenerate", i, tri);
			continue;
		}
		union(parents, check_geom.index.array[i], check_geom.index.array[i+1]);
		union(parents, check_geom.index.array[i+1], check_geom.index.array[i+2]);
		union(parents, check_geom.index.array[i], check_geom.index.array[i+2]);
	}

	for (let i = 0; i < parents.length; i++) {
		parents[i] = find(parents, parents[i]);
	}
	// console.log("check_geom", check_geom)
	// console.log("parents", check_geom.index.array.length, parents)

	for (let i = 0; i < parents.length; i++) {
		if (parents[i] < 0) {

			// console.log("component", i, parents[i]);

			let new_geom = new THREE.BufferGeometry();
			let vertices = [];

			for (let j = 0; j < check_geom.index.array.length; j++) {
				if (parents[check_geom.index.array[j]] == i || check_geom.index.array[j] == i) {
					let v_index = check_geom.index.array[j];
					vertices.push(check_geom.attributes.position.getX(v_index));
					vertices.push(check_geom.attributes.position.getY(v_index));
					vertices.push(check_geom.attributes.position.getZ(v_index));
				}
			}

			// next, ignore indexes from the component
			for (let j = 0; j < parents.length; j++) {
				if (j == i || parents[j] == i) {
					parents[j] = parents.length;
				}
			}

			new_geom.setAttribute('position', new THREE.Float32BufferAttribute( vertices, 3 ));
			new_geoms.push(new_geom);
		}
	}

	return new_geoms;
}

window.addEventListener('resize', function () {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize( window.innerWidth, window.innerHeight );
}, false);

window.addEventListener( 'keydown', function ( e ) {
	switch ( e.code ) {
		case 'KeyW':
			transformControls.setMode( 'translate' );
			break;
		case 'KeyE':
			transformControls.setMode( 'rotate' );
			break;
		case 'KeyR':
			transformControls.setMode( 'scale' );
			break;
		case 'ArrowLeft':
			brush2.position.x -= 0.2;
			needsUpdate = true;
			break;
		case 'ArrowRight':
			brush2.position.x += 0.2;
			needsUpdate = true;
			break;
		case 'ArrowUp':
			brush2.position.y += 0.1;
			needsUpdate = true;
			break;
		case 'ArrowDown':
			brush2.position.y -= 0.1;
			needsUpdate = true;
			break;
		case 'KeyU':
			needsUpdate = true;
			break;
	}
});
