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
uniform vec3 lightdir = vec3(0.0, 0.0, 1.0);
uniform float sunSharpness = 1;
uniform float sunPower = 4;
uniform float skyPower = 0.4;
uniform float sunlightStrength = 1.0;
uniform float frameCount;
uniform sampler3D scene;
uniform ivec3 sceneSize;
uniform int octreeDepth;

uniform vec3 materialColor = vec3(0.5);

uniform sampler2D blueNoise;

uniform mat4 cameraMatrix;

const float glowScale = 5;
vec3 glowColor = vec3(0.5, 0.8, 1.0);

layout (location = 0) out vec4 outColor;
out float gl_FragDepth;

#define PI 3.1415926535897932384626433832795

vec4 getBlueNoise(ivec2 p) {
	return texelFetch(blueNoise, p+int(frameCount)*ivec2(113, 127), 0);
}

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
					0,		        1.0,	0,	        0,
					-sin(angle),	0,		cos(angle),	0,
					0, 		        0,	    0,	        1);
}

mat4 rotationZ( in float angle ) {
	return mat4(	cos(angle), -sin(angle), 0,	0,
					sin(angle), cos(angle),	 0,	0,
					0,			0,		     1,	0,
					0,			0,		     0,	1);
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

vec3 getColor(ivec3 c, int l) {
	return texelFetch(scene, clamp(c, ivec3(0), sceneSize), l).rgb;
}

vec4 trace(vec2 p) {
	vec2 s = vec2(p.x - iResolution.x/2.0f, p.y - iResolution.y/2.0f);
	vec3 raypos = (cameraMatrix * vec4(0, 0, 0, 1)).xyz; //TODO precompute these values
	vec3 raydir = normalize(vec3(s.x/iResolution.y, fov, s.y/iResolution.y));
	raydir = (cameraMatrix * vec4(raydir, 0.0)).xyz;

	vec3 outColor = vec3(1);

	vec3 n;
	vec2 res;

	if(!(insideBoundingBox(raypos, vec3(0), vec3(sceneSize)))) {
		if(rayAABB(raypos, raydir, vec3(0, 0, 0), vec3(sceneSize), res, n)) {
			raypos += raydir * (res.x - 0.01);
		} else {
			return vec4((suncolor * pow(max(dot(normalize(lightdir), raydir), 0.0), sunSharpness) * sunPower + skycolor * skyPower) * sunlightStrength, 10000000);
		} //TODO normal data is not needed
	}

	int maxLevel = octreeDepth-1;
	int level = maxLevel/2;

	float complexity = maxLevel/2;

	ivec3 gridPosition = ivec3(floor(raypos));

	vec3 deltaDist = abs(vec3(1)/raydir);
    ivec3 step = ivec3(sign(raydir));
	bvec3 raydirsign = greaterThan(sign(raydir), vec3(0));

	vec3 nextEdge = vec3(gridPosition & ivec3(-1 << level)) + vec3(greaterThan(raydir, vec3(0.0))) * (1 << level);
	vec3 sideDist = abs((nextEdge - raypos) * deltaDist);

	float dist;
    vec3 normal = vec3(0.0);

	bool moved = false;
	bool lastNonEmpty = true;

	int steps = 0;
	float sunlight = 0;
	vec3 luminance = vec3(0);
	float depth = 0;

	for(int i=0; i<maxSteps; i++) {
		if(!insideBoundingBox(gridPosition, vec3(-2), sceneSize + vec3(1))) {
			sunlight = sunlightStrength;
			break;
		}

		bool nonEmpty = getVoxel(gridPosition >> level, level);
		bool belowEmpty = !getVoxel(gridPosition >> (level + 1), level + 1) && level < maxLevel;
		bool verticalMove = nonEmpty || belowEmpty;

		if(verticalMove) {
			complexity += int(nonEmpty);

			vec3 lraypos = raypos;
			if(moved) {
				lraypos = raypos + raydir * dist;
			}

			gridPosition = ivec3(floor(lraypos - normal * 0.0001));

			if(level == 0 && nonEmpty) {
				complexity -= 1;
				// return vec4(getColor(gridPosition >> level, level), 1.0);
				// return vec4(vec3(dist/128), 1.0);
				outColor *= getColor(gridPosition >> level, level);
				// outColor *= 0.5;

				if(depth == 0) {
					depth = dist;
				}

				lraypos += normal * 0.01;
				
				raypos = lraypos;
				raydir = scatter(normal);
				deltaDist = abs(vec3(1)/raydir);
				step = ivec3(sign(raydir));
				raydirsign = greaterThan(sign(raydir), vec3(0));
				dist = 0;
			}

			level -= int(nonEmpty);
			level = max(0, level);
			level += int(!nonEmpty);
			
			nextEdge = vec3(gridPosition & ivec3(-1 << level)) + vec3(greaterThan(raydir, vec3(0.0))) * (1 << level);
			sideDist = abs((nextEdge - lraypos) * deltaDist);

			if(moved) {
				sideDist += dist;
			}
		}

		if(!verticalMove) {
			float minTime = min(sideDist.x, min(sideDist.y, sideDist.z));
			dist = minTime;

			bvec3 mask = lessThanEqual(sideDist.xyz, min(sideDist.yzx, sideDist.zxy));
			ivec3 vstep = ivec3(mix(-1, 1 << level, raydirsign.x), mix(-1, 1 << level, raydirsign.y), mix(-1, 1 << level, raydirsign.z));
			gridPosition = (gridPosition & ivec3(-1 << level)) + ivec3(mask) * vstep;
			sideDist += vec3(mask) * deltaDist * vec3(1 << level);
			normal = vec3(mask) * -step; //WRONG NORMAL DATA!!!!?
			moved = true;
		}

		lastNonEmpty = nonEmpty;
		steps = i;
	}

	if(depth == 0) {
		depth = 10000000;
	}

	return vec4(outColor * (suncolor * pow(max(dot(normalize(lightdir), raydir), 0.0), sunSharpness) * sunPower + skycolor * skyPower), depth + res.x);
	// return vec4(vec3(float(steps)/maxSteps), 1.0);
	// return vec4(outColor, 1);
	// return vec4(vec3(complexity/(maxLevel * 4)), 1);
	// return vec4(vec3(dist/128), 1);
}

void mainImage(in vec2 fragCoord )
{
	float samplesCount = samples;
	g_seed = float(base_hash(floatBitsToUint(fragCoord)))/float(0xffffffffU)+frameCount/60;

	// world[0] = vec3(-1, -1, 0);
	// world[1] = vec3(1, 1, 2);

	for(int i=0; i < samples; i++) {
		vec2 p = fragCoord;
		// p += getBlueNoise(ivec2(gl_FragCoord)).xy * 2 - 1;
		p += 0.25 * (rand2(g_seed) * 2 - 1);
		p.y = iResolution.y - p.y;
		vec4 col = trace(p);

		outColor += vec4(col.rgb, 1.0);
		gl_FragDepth += log(col.a*10)/10;
	}

	outColor /= samplesCount;
	gl_FragDepth /= samplesCount;
	
	// outColor.xyz = rand3();
	// outColor.w = 1.0;

	outColor = pow(outColor, vec4(vec3(1.0/1.8), 1.0)); //Add night eye minecraft shader trick here too
}

void main() {
	mainImage(gl_FragCoord.xy);
}