#version 460

out vec4 outColor;
out float gl_FragDepth;

uniform sampler2D renderedFrame;
uniform sampler2D renderedFrameDepth;
uniform sampler2D pastFrame;
uniform sampler2D pastFrameDepth;

uniform vec2 iResolution; 
uniform float reproPercent = 0.99;
uniform float focalLength;
uniform int frameCount;

uniform mat4 invPastCameraMatrix;
uniform mat4 cameraMatrix;

// https://iquilezles.org/www/articles/intersectors/intersectors.htm
float planeIntersect( in vec3 ro, in vec3 rd, in vec4 p )
{
    return -(dot(ro,p.xyz)+p.w)/dot(rd,p.xyz);
}

void main() {
    vec2 textureCoordinate = gl_FragCoord.xy/iResolution;
    float reprojectionPercentWeighted = reproPercent;
    float aspectRatio = iResolution.x/iResolution.y;

    // Get the freshly rendered color and depth information
    vec4 renderedFrameColor = texture(renderedFrame, textureCoordinate);
    float renderedFrameDepthFloat = texture(renderedFrameDepth, textureCoordinate).r*10000;

    // Setup a raycast to find the worldspace position of the current pixel
    vec2 s = vec2((gl_FragCoord.x) - iResolution.x/2.0f, (iResolution.y - gl_FragCoord.y) - iResolution.y/2.0f);
	vec3 raypos = (cameraMatrix * vec4(0, 0, 0, 1)).xyz; //TODO precompute these values
	vec3 raydir = normalize(vec3(s.x/iResolution.y, focalLength, s.y/iResolution.y));
	raydir = (cameraMatrix * vec4(raydir, 0.0)).xyz;
    vec3 worldSpacePosition = raypos + raydir * renderedFrameDepthFloat;

    // Then transform that world space position into a camera space position for the last frame
    vec3 cameraSpacePosition = (invPastCameraMatrix * vec4(worldSpacePosition, 1.0)).xyz;

    // Find the ray direction between the camera space position and last frames camera
    vec3 reproRayDir = normalize(-cameraSpacePosition);

    // Calculate the intersection between that and a plane at the focal length of the camera, then use that intersection point to find the pixel from last frame that matches up with the pixel from this frame
    float cameraIntersection = planeIntersect(cameraSpacePosition, reproRayDir, vec4(0.0, 1.0, 0.0, focalLength));
    vec2 prevUV = (cameraSpacePosition + cameraIntersection * reproRayDir).xz;
    prevUV.x /= iResolution.x/iResolution.y;
    prevUV += 0.5;
    prevUV.x = 1.0 - prevUV.x;

    // Then get the color of that pixel
    // vec4 pastFrameColor = texelFetch(pastFrame, ivec2(prevUV * iResolution), 0);
    vec4 pastFrameColor = textureLod(pastFrame, prevUV, 0.0);
    pastFrameColor.rgb = pow(pastFrameColor.rgb, vec3(2.2)); // Reverse the srgb color transform applied to it
    float pastFrameDepthFloat = texture(pastFrameDepth, prevUV).r*10000;

    // If the camera space coordinate is outside of the previous frame then reject it.
    if (cameraSpacePosition.y < focalLength || any(greaterThan(prevUV, vec2(1))) || any(lessThan(prevUV, vec2(0)))) {
        reprojectionPercentWeighted = 0;
    }

    // Don't reproject the sky
    if(pastFrameDepthFloat > 9999) {
        reprojectionPercentWeighted = 0;
    }

    // If the distance of the previous coordinate is too different from the distance of the current frame reject it aswell. This means an occlusion/dissoclusion occured
    if(abs(renderedFrameDepthFloat - pastFrameDepthFloat) > 25) {
        reprojectionPercentWeighted = 0.0;
    }

    // Finally average out the depth and color information
    outColor = renderedFrameColor * (1.0 - reprojectionPercentWeighted) + pastFrameColor * reprojectionPercentWeighted;
    gl_FragDepth = renderedFrameDepthFloat/10000 * (1.0 - reprojectionPercentWeighted) + pastFrameDepthFloat/10000 * reprojectionPercentWeighted;

    // Uncomment this code to render once a second and extrapolate between frames
    // if(frameCount % 60 == 0) {
    //     outColor = renderedFrameColor;
    //     gl_FragDepth = renderedFrameDepthFloat/10000;
    // } else {
    //     outColor = pastFrameColor;
    //     if(pastFrameColor.a < 0.1 || reprojectionPercentWeighted < 0.1) {
    //         outColor = vec4(1.0, 0.0, 0.0, 1.0);
    //     }
    // }

    // And apply an srgb color transform
    outColor = pow(outColor, vec4(vec3(1.0/2.2), 1.0));
}