#version 460

uniform vec2 iResolution; 
out vec4 outColor;

uniform sampler2D renderedFrame;
uniform sampler2D renderedFrameDepth;
uniform sampler2D pastFrame;
uniform float reproPercent = 0.99;
uniform float fov;
uniform int frameCount;

uniform mat4 invPastCameraMatrix;
uniform mat4 cameraMatrix;

#define E_CONST 2.71828182845904523536028747135266249775724709369995 

const int rejectionRadius = 1;

in vec2 texcoord;

float avgVec(vec3 v) {
    return (v.x + v.y + v.z)/3;
}

//https://iquilezles.org/www/articles/intersectors/intersectors.htm
float planeIntersect( in vec3 ro, in vec3 rd, in vec4 p )
{
    return -(dot(ro,p.xyz)+p.w)/dot(rd,p.xyz);
}

void main() {
    float reproWeighted = reproPercent;
    vec4 renderedFrameColor = texture(renderedFrame, texcoord);
    float renderedFrameDepth = pow(E_CONST, texture(renderedFrameDepth, texcoord).r * 10)/10;

    vec2 s = vec2((gl_FragCoord.x) - iResolution.x/2.0f, (iResolution.y - gl_FragCoord.y) - iResolution.y/2.0f);
	vec3 raypos = (cameraMatrix * vec4(0, 0, 0, 1)).xyz; //TODO precompute these values
	vec3 raydir = normalize(vec3(s.x/iResolution.y, fov, s.y/iResolution.y));
	raydir = (cameraMatrix * vec4(raydir, 0.0)).xyz;

    vec3 worldspacepos = raypos + raydir * renderedFrameDepth;

    vec3 cameraspacepos = (invPastCameraMatrix * vec4(worldspacepos, 1.0)).xyz;

    vec3 reproRayDir = normalize(-cameraspacepos);

    float cameraIntersection = planeIntersect(cameraspacepos, reproRayDir, vec4(0.0, 1.0, 0.0, fov));
    vec2 prevUV = (cameraspacepos + cameraIntersection * reproRayDir).xz;
    prevUV.x /= iResolution.x/iResolution.y;
    prevUV += 0.5;
    prevUV.x = 1.0 - prevUV.x;
    // prevUV.x /= iResolution.y/iResolution.x;

    // if(worldspacepos.x < 20) {
    //     outColor = vec4(worldspacepos/128, 1.0);
    //     return;
    // }

    vec4 pastFrameColor = texture(pastFrame, prevUV);
    // vec4 pastFrameColor = texelFetch(pastFrame, ivec2(prevUV * iResolution), 0);

    vec3 minColor = vec3(10000);
    vec3 maxColor;

    // for(int x=-rejectionRadius; x<=rejectionRadius; x++) {
    //     for(int y=-rejectionRadius; y<=rejectionRadius; y++) {
    //         vec2 delta = vec2(float(x)/iResolution.x, float(y)/iResolution.y);
    //         vec4 col = texture(renderedFrame, texcoord + delta);

    //         if(col.a < 0.1) {
    //             continue;
    //         }

    //         minColor = min(minColor, col.rgb);
    //         maxColor = max(maxColor, col.rgb);
    //     }
    // }

    // if(any(!(lessThan(pastFrameColor.rgb, maxColor)))) {
    //     reproWeighted /= 1.0 + abs(avgVec(pastFrameColor.rgb - maxColor)) * 2;
    // }

    // if(any(!(greaterThan(pastFrameColor.rgb, minColor)))) {
    //     reproWeighted /= 1.0 + abs(avgVec(pastFrameColor.rgb - minColor)) * 2;
    // }

    if(renderedFrameDepth > 500) {
        pastFrameColor.a = 0.0;
    }

    if(pastFrameColor.a < 0.1) {
        outColor = renderedFrameColor;
    } else {
	    outColor = renderedFrameColor * (1.0 - reproWeighted) + pastFrameColor * reproWeighted;
    }

    // if(frameCount % 60 == 0) {
    //     outColor = renderedFrameColor;
    // } else {
    //     outColor = pastFrameColor;
    //     if(pastFrameColor.a < 0.1) {
    //         outColor = vec4(1.0, 0.0, 0.0, 1.0);
    //     }
    // }

    // outColor = vec4(vec3(previousUV, 0.0) - vec3(texcoord, 0.0), 1.0);

    // outColor = vec4(vec3(s, 0.0), 1.0);
    // outColor = vec4(cameraspacepos, 1.0);
    // outColor = vec4(vec3(prevUV, 0.0), 1.0);
    // outColor = vec4(point.xyz/128, 1.0);


    // outColor = vec4(vec3(renderedFrameDepth/128), 1.0);

    // outColor = vec4(previousUV, 0.0, 1.0);
}