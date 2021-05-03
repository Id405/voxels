#version 460

uniform vec2 iResolution; 
out vec4 outColor;

uniform sampler2D renderedFrame;
uniform sampler2D renderedFrameDepth;
uniform sampler2D pastFrame;
uniform sampler2D pastFrameDepth;
uniform float reproPercent = 0.99;
uniform float fov;
uniform int frameCount;

uniform mat4 invPastCameraMatrix;
uniform mat4 cameraMatrix;

#define E_CONST 2.71828182845904523536028747135266249775724709369995 

const int rejectionRadius = 1;

in vec2 texcoord;

out float gl_FragDepth;

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
    float renderedFrameDepthFloat = texture(renderedFrameDepth, texcoord).r*10000;

    float aspectRatio = iResolution.x/iResolution.y;

    vec2 s = vec2((gl_FragCoord.x) - iResolution.x/2.0f, (iResolution.y - gl_FragCoord.y) - iResolution.y/2.0f);
	vec3 raypos = (cameraMatrix * vec4(0, 0, 0, 1)).xyz; //TODO precompute these values
	vec3 raydir = normalize(vec3(s.x/iResolution.y, fov, s.y/iResolution.y));
	raydir = (cameraMatrix * vec4(raydir, 0.0)).xyz;

    vec3 worldspacepos = raypos + raydir * renderedFrameDepthFloat;

    vec3 cameraspacepos = (invPastCameraMatrix * vec4(worldspacepos, 1.0)).xyz;

    vec3 reproRayDir = normalize(-cameraspacepos);

    float cameraIntersection = planeIntersect(cameraspacepos, reproRayDir, vec4(0.0, 1.0, 0.0, fov));
    vec2 prevUV = (cameraspacepos + cameraIntersection * reproRayDir).xz;
    prevUV.x /= iResolution.x/iResolution.y;
    prevUV += 0.5;
    prevUV.x = 1.0 - prevUV.x;

    if (cameraspacepos.y < fov || any(greaterThan(prevUV, vec2(1))) || any(lessThan(prevUV, vec2(0)))) {
        reproWeighted = 0;
    }

    // vec4 pastFrameColor = texelFetch(pastFrame, ivec2(prevUV * iResolution), 0);
    vec4 pastFrameColor = textureLod(pastFrame, prevUV, 0.0);
    pastFrameColor.rgb = pow(pastFrameColor.rgb, vec3(2.2));
    float pastFrameDepthFloat = texture(pastFrameDepth, prevUV).r*10000;

    vec3 minColor = vec3(10000);
    vec3 maxColor;

    float minDepth = 100000;
    float maxDepth = 0;

    // for(int x=-rejectionRadius; x<=rejectionRadius; x++) {
    //     for(int y=-rejectionRadius; y<=rejectionRadius; y++) {
    //         vec2 delta = vec2(float(x)/iResolution.x, float(y)/iResolution.y);
    //         vec4 col = texture(renderedFrame, texcoord + delta);
    //         float depth = texture(renderedFrameDepth, texcoord + delta).r*10000;

    //         if(col.a < 0.1) {
    //             continue;
    //         }

    //         minColor = min(minColor, col.rgb);
    //         maxColor = max(maxColor, col.rgb);

    //         minDepth = min(minDepth, depth);
    //         maxDepth = max(maxDepth, depth);
    //     }
    // }

    // if(any(!(lessThan(pastFrameColor.rgb, maxColor)))) {
    //     reproWeighted /= 1.0 + abs(avgVec(pastFrameColor.rgb - maxColor)) * 10;
    // }

    // if(any(!(greaterThan(pastFrameColor.rgb, minColor)))) {
    //     reproWeighted /= 1.0 + abs(avgVec(pastFrameColor.rgb - minColor)) * 10;
    // }

    // if(pastFrameDepthFloat < minDepth || pastFrameDepthFloat > maxDepth) {
    //     reproWeighted = 0;
    // }

    if(pastFrameDepthFloat > 9999) {
        pastFrameColor.a = 0.0;
    }

    if(abs(renderedFrameDepthFloat - pastFrameDepthFloat) > 25) {
        pastFrameColor.a = 0.0;
    }

    if(pastFrameColor.a < 0.1) {
        outColor = renderedFrameColor;
        gl_FragDepth = renderedFrameDepthFloat/10000;
    } else {
	    outColor = renderedFrameColor * (1.0 - reproWeighted) + pastFrameColor * reproWeighted;
        gl_FragDepth = renderedFrameDepthFloat/10000 * (1.0 - reproWeighted) + pastFrameDepthFloat/10000 * reproWeighted;
    }

    // if(frameCount % 60 == 0) {
    //     outColor = renderedFrameColor;
    //     gl_FragDepth = renderedFrameDepthFloat/10000;
    // } else {
    //     outColor = pastFrameColor;
    //     if(pastFrameColor.a < 0.1 || reproWeighted < 0.1) {
    //         outColor = vec4(1.0, 0.0, 0.0, 1.0);
    //     }
    // }

    outColor = pow(outColor, vec4(vec3(1.0/2.2), 1.0));

    // outColor = vec4(vec3(abs(pastFrameDepthFloat - renderedFrameDepthFloat)/50), 1);
    // outColor = vec4(vec3(pastFrameDepthFloat/256), 1);
    // outColor = vec4(vec3(renderedFrameDepthFloat/256), 1.0);
}