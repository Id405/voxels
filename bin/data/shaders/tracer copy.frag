#version 460

uniform vec2 iResolution; 
uniform float samples = 10; /*BAD*/
uniform int maxBounces = 10;
uniform int maxSteps;
uniform float fov;

uniform float maxLight = -1;
uniform float minLight = 0;

// uniform vec3 skycolor = vec3(135.0/255.0, 206.0/255.0, 235.0/255.0); // actual sky color
uniform vec3 skycolor = vec3(0.9); //gray
uniform vec3 suncolor = vec3(192.0/255.0, 191.0/255.0, 173.0/255.0);
uniform vec3 lightcolor = vec3(5, 0, 0);
uniform vec3 lightdir = vec3(0.5, -1.0, 1.0);
uniform float sunSharpness = 5;
uniform float sunPower = 20.0;
uniform float skyPower = 0.2;
uniform float frameCount;
uniform sampler3D scene;
uniform ivec3 sceneSize;
uniform int octreeDepth;

uniform vec3 materialColor = vec3(0.5);

uniform vec3 transl = vec3(0, 0, 0);
uniform vec3 rotation;

const float glowScale = 5;
vec3 glowColor = vec3(0.5, 0.8, 1.0);

out vec4 outColor;

#define PI 3.1415926535897932384626433832795


uint base_hash(uvec2 p) {
    p = 1103515245U*((p >> 1U)^(p.yx));
    uint h32 = 1103515245U*((p.x)^(p.y>>3U));
    return h32^(h32 >> 16);
}

float g_seed = 0.;

vec2 rand2(inout float seed) {
    uint n = base_hash(floatBitsToUint(vec2(seed+=1,seed+=1)));
    uvec2 rz = uvec2(n, n*48271U);
    return vec2(rz.xy & uvec2(0x7fffffffU))/float(0x7fffffff);
}

vec3 rand3(inout float seed) {
    uint n = base_hash(floatBitsToUint(vec2(seed+=1,seed+=1)));
    uvec3 rz = uvec3(n, n*16807U, n*48271U);
    return vec3(rz & uvec3(0x7fffffffU))/float(0x7fffffff);
}


vec3 random_in_unit_sphere() { //OPTIMIZE
    vec3 h = rand3(g_seed) * vec3(2.,6.28318530718,1.)-vec3(1,0,0);
    float phi = h.y;
    float r = pow(h.z, 1./3.);
	return r * vec3(sqrt(1.-h.x*h.x)*vec2(sin(phi),cos(phi)),h.x);
}

vec3 scatter(vec3 n) {
	vec3 dr = random_in_unit_sphere();
	return sign(dot(dr, n))*dr;
}


mat4 rotationX( in float angle ) { //https://gist.github.com/onedayitwillmake/3288507
	return mat4(	1.0,		0,			0,			0,
									0, 	cos(angle),	-sin(angle),		0,
									0, 	sin(angle),	 cos(angle),		0,
									0, 			0,			  0, 		1);
}

mat4 rotationY( in float angle ) {
	return mat4(	cos(angle),		0,		sin(angle),	0,
								0,		1.0,			 0,	0,
								-sin(angle),	0,		cos(angle),	0,
								0, 		0,				0,	1);
}

mat4 rotationZ( in float angle ) {
	return mat4(	cos(angle),		-sin(angle),	0,	0,
								sin(angle),		cos(angle),		0,	0,
								0,				0,		1,	0,
								0,				0,		0,	1);
}

vec3 rotate(vec3 r, vec3 p) {
	vec4 vertex = vec4(p.xyz, 1.0);

	vertex = vertex * rotationX(r.x) * rotationY(r.y) * rotationZ(r.z);

	return vertex.xyz;
}

// void getVoxelIndex(int i, out vec3 boxMin, out vec3 boxMax) {
// 	if(i > voxelCount) return;
// 	boxMin = world[i*2];
// 	boxMax = world[i*2+1];
// 	return;
// }

bool rayAABB(vec3 rayOrigin, vec3 rayDir, vec3 boxMin, vec3 boxMax, out vec2 result, out vec3 normal) {
    vec3 rayInvDir = 1.0 / rayDir; //Can be precomputed on a set of aligned boxes
    vec3 tbot = rayInvDir * (boxMin - rayOrigin);
    vec3 ttop = rayInvDir * (boxMax - rayOrigin);
    vec3 tmin = min(ttop, tbot);
    vec3 tmax = max(ttop, tbot);
    vec2 t = max(tmin.xx, tmin.yz);
    float t0 = max(t.x, t.y);
    t = min(tmax.xx, tmax.yz);
    float t1 = min(t.x, t.y);
    result = vec2(t0, t1);
	if(t1 <= max(t0, 0.0)) return false;
	normal = -sign(rayDir)*step(tmin.yzx,tmin.xyz)*step(tmin.zxy,tmin.xyz);
    return true;
}

bool insideBoundingBox(vec3 p, vec3 min, vec3 max) {
	return p.x > min.x && p.x < max.x && p.y > min.y && p.y < max.y && p.z > min.z && p.z < max.z;
}

bool getVoxel(ivec3 c, int l) {
	return texelFetch(scene, c, l).a != 0;
}

void calcDDA(in vec3 raypos, in vec3 raydir, out vec3 sideDist, out vec3 deltaDist, out ivec3 mapPos, out ivec3 rayStep) {
	mapPos = ivec3(floor(raypos));
	deltaDist = abs(vec3(length(raydir)) / raydir);
	rayStep = ivec3(sign(raydir));
	sideDist = (sign(raydir) * (vec3(mapPos) - raypos) + (sign(raydir) * 0.5) + 0.5) * deltaDist;
}

// bool march(in vec3 raypos, in vec3 raydir, in int level, out vec3 normal, out float dist) {
// 	ivec3 gridPosition = ivec3(floor(raypos + 0.));
// 	ivec3 startGridPosition = gridPosition;

// 	vec3 tSpeed = abs(vec3(1.0) / raydir);
//     ivec3 vstep = ivec3(greaterThan(raydir, vec3(0.0))) * 2 - ivec3(1);

//     vec3 nextEdge = gridPosition + vec3(vstep) * 0.5 + vec3(0.5);
    
//     vec3 timeToEdge = abs((nextEdge - raypos) * tSpeed);
//     float f = 0.0;

// 	for(int i=0; i<maxSteps; i++) {
// 		bvec3 mask = lessThanEqual(timeToEdge.xyz, min(timeToEdge.yzx, timeToEdge.zxy));
// 		gridPosition += ivec3(mask) * vstep;
// 		timeToEdge += vec3(mask) * tSpeed;
// 		if(!insideBoundingBox(gridPosition << level, vec3(-1.01), sceneSize + 1.01)) {
// 			return false;
// 		}
// 		normal = vec3(mask) * -vec3(vstep);
// 		if(getVoxel(gridPosition, level)) {
// 			// vec3 endpos = gridPosition +  vec3(mask) * -vec3(vstep);
// 			// dist = distance(raypos, endpos);
// 			vec2 res; //TODO optimize
// 			rayAABB(raypos*pow(2, level), raydir, gridPosition << level, (gridPosition+1) << level, res, normal);
// 			dist = res.x - 0.1;
// 			return true;
// 		}
// 	}
// }

vec4 trace(vec2 p, vec3 transl) {
	vec2 s = vec2(p.x - iResolution.x/2.0f, p.y - iResolution.y/2.0f);
	vec3 raypos = transl; //TODO precompute these values
	vec3 raydir = normalize(vec3(s.x/iResolution.x, fov, s.y/iResolution.x));
	raydir = rotate(rotation, raydir);

	float bounces = 0.0;
	vec3 luminance = vec3(0);

	vec3 n;
	vec2 res;

	if(!(insideBoundingBox(raypos, vec3(0), vec3(sceneSize)))) {
		if(rayAABB(raypos, raydir, vec3(0, 0, 0), vec3(sceneSize), res, n)) {
			raypos += raydir * (res.x - 0.01);
		} else {
			// return vec4(suncolor * pow(max(dot(normalize(lightdir), raydir), 0.0), sunSharpness) * sunPower + skycolor * skyPower, 1);
			return vec4(0.6, 0.3, 0.3, 1.0);
		} //TODO normal data is not needed
	}

	// vec3 normal;

	// int level = octreeDepth-1;
	// vec3 oraypos = raypos;

	// raypos = oraypos/pow(2, level);

	// float iters = 0;
	// ivec3 mapPos;
	// vec3 deltaDist;
	// ivec3 rayStep;
	// vec3 sideDist; 
	// bvec3 mask;

	// calcDDA(raypos, raydir, sideDist, deltaDist, mapPos, rayStep);

	// for(int i=0; i < maxSteps; i++) {
	// 	if(!(insideBoundingBox(vec3(mapPos), vec3(-1.01), vec3(sceneSize)/pow(2, level) + vec3(0.01)))) {
	// 		luminance += suncolor * pow(max(dot(normalize(lightdir), raydir), 0.0), sunSharpness) * sunPower + skycolor * skyPower;
	// 		break;
	// 	}
	// 	if(getVoxel(mapPos, level)) {
	// 		normal = -1 * sign(raydir) * vec3(mask);
	// 		iters++;
	// 		vec2 result;
	// 		// if(!(rayAABB(oraypos, raydir, mapPos*pow(2, level), mapPos*pow(2, level)+pow(2, level), result, normal))) { //TODO find out how to do this without intersection
	// 		// 	return vec4(1, 0, 0, 1); //Also intersection function that doesn't calculate normals
	// 		// }
	// 		// oraypos += raydir * (result.x - 1);
	// 		// return vec4(normal, 1);
	// 		oraypos = mapPos*pow(2, level)-raypos*pow(2, level)*0.1;
	// 		// oraypos -= raydir;
			
	// 		if(level == 0) {
	// 			hit = 1;
	// 			break;
	// 			oraypos += normal * 0.01;
	// 			raydir = scatter(normal);
	// 			bounces += 1;
	// 		} else {
	// 			level -= 1;
	// 		}
	// 		raypos = oraypos/pow(2, level);

	// 		calcDDA(raypos, raydir, sideDist, deltaDist, mapPos, rayStep);
	// 	} 
	// 	// else if(level < octreeDepth-1 && !getVoxel(ivec3(mapPos*pow(2, level)/pow(2, level+1)), level+1)) {
	// 	// 	vec2 result;
	// 	// 	if(!(rayAABB(oraypos, raydir, mapPos*pow(2, level), mapPos*pow(2, level)+pow(2, level), result, normal))) { //TODO find out how to do this without intersection
	// 	// 		return vec4(1, 0, 0, 1); //Also intersection function that doesn't calculate normals
	// 	// 	}
	// 	// 	oraypos += raydir * result.x;
	// 	// 	level += 1;

	// 	// 	raypos = oraypos/pow(2, level);
	// 	// 	calcDDA(raypos, raydir, sideDist, deltaDist, mapPos, rayStep);
	// 	// }

	// 	mask = lessThanEqual(sideDist.xyz, min(sideDist.yzx, sideDist.zxy));

	// 	sideDist += vec3(mask) * deltaDist;
	// 	mapPos += ivec3(vec3(mask)) * rayStep;
	// }
	int level = octreeDepth-1;
	// int voxelSize = 1 << level;

	float hit = 0;

	ivec3 gridPosition = ivec3(floor(raypos));
	gridPosition = gridPosition >> level;

	vec3 deltaDist = abs(vec3(1)/raydir);
    ivec3 step = ivec3(sign(raydir));

    vec3 sideDist = (sign(raydir) * (gridPosition - (raypos/(1 << level))) + ((sign(raydir) * 0.5) + 0.5)) * deltaDist;
	float dist;
    vec3 normal = vec3(0.0);

	for(int i=0; i<maxSteps; i++) {
		float minTime = min(sideDist.x, min(sideDist.y, sideDist.z));
		dist += minTime;

		if(getVoxel(gridPosition, level)) {
			if(level == 0) {
				hit = i;
				break;
			}
			level -= 1;

			gridPosition = gridPosition << 1;
			raypos = raydir * dist;

			sideDist = (sign(raydir) * (gridPosition - (raypos/(1 << level))) + ((sign(raydir) * 0.5) + 0.5)) * deltaDist;
			
			//gridPosition = gridPosition << 1;
		}

		// if(!insideBoundingBox(gridPosition, vec3(0), sceneSize)) {
		// 	break;
		// }

		bvec3 mask = lessThanEqual(sideDist.xyz, min(sideDist.yzx, sideDist.zxy));
		gridPosition += ivec3(mask) * step;
		sideDist += vec3(mask) * deltaDist;
		normal = vec3(mask) * -vec3(step);
	}

	// vec3 normal = vec3(0.0);
	// float dist;
	// int level = octreeDepth-1;
	// bool hit;
	// int steps;
	

	// for(int i=0; i<24 /*MAGIC*/; i++) {//TODO subgroupAny() this
	// 	steps = i;
	// 	hit = march(raypos/pow(2, level), raydir, level, normal, dist); //TODO USE BITSHIFTING FOR THIS
	// 	if(!hit) {
	// 		break;
	// 	}
	// 	if(level == 0) {
	// 		break;
	// 	}
	// 	//This means that we have to traverse lower in the octree
	// 	raypos += raydir * dist;
	// 	level--;
	// }
	
	// ivec3 voxelP = ivec3(floor(raypos));
	// ivec3 stepDir = sign(raydir);
	// vec3 tMax = 

	

	// return vec4((normal+1)/2*int(hit), 1.0);
	return vec4(vec3(hit/maxSteps), 1.0);
	// return vec4(pow(materialColor, vec3(bounces)), 1.0);
	// return vec4(vec3(1.0-bounces), 1.0);
	// return vec4(luminance * pow(materialColor, vec3(bounces)), 1.0);
}

void mainImage(in vec2 fragCoord )
{
	float samplesCount = samples;
	g_seed = float(base_hash(floatBitsToUint(fragCoord)))/float(0xffffffffU)+frameCount/60;

	// world[0] = vec3(-1, -1, 0);
	// world[1] = vec3(1, 1, 2);

	for(int i=0; i < samples; i++) {
		vec4 col = trace(fragCoord+(rand2(g_seed)*2-1), transl);

		outColor += col;
	}

	outColor /= samplesCount;
	
	// outColor.xyz = rand3();
	// outColor.w = 1.0;

	outColor = pow(outColor, vec4(vec3(1.0/2.2), 1.0));
}

void main() {
	mainImage(gl_FragCoord.xy);
}