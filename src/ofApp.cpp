#include "ofApp.h"

void ofApp::setup(){
	{ // Setup OpenGl stuff
		glEnable(GL_DEPTH_TEST); // Enable depth buffers/textures
		glDepthFunc(GL_ALWAYS); // But tell OpenGl to not actually use them to obscure geometry.
		ofSetVerticalSync(false); //VSync is evil
		ofDisableArbTex(); // I don't know what this does but it breaks everything if its not here. Something about setting the texture mode
	}

	{
		position.set(-20, -20, 48);
		rotation.set(-0.4, 0, -0.8);
	}

	{ // Load Shaders and scene
		rayTracer.load("shaders/tracer");
		denoiser.load("shaders/denoiser");
		loadVoxelData("scenes/garfield.evox");
		// genWorld();
	}

	{ // Initialize gui
		gui.setup();
		gui.add(samples.setup("samples", 10, 1, 200));
		gui.add(maxSteps.setup("max steps", 200, 50, 256));
		gui.add(reproPercent.setup("reprojection percent", 0.0, 0.5, 1));
		gui.add(moveSpeed.setup("move speed", 25, 1, 50));
		gui.add(label.setup("frametime", "initializing", 200, 25));
		gui.add(fps.setup("fps", "initializing", 200, 25));
		gui.add(reload.setup("reload shaders", 200, 25));
	}

	// Setup the frame buffer objects
	reloadFBO();
}

void ofApp::update() {
	{ // Update the position using the keyboard input
		ofVec3f rotatedInput = input.getRotatedRad(0, 0, rotation.z);
		position += rotatedInput * ofGetLastFrameTime() * moveSpeed;
	}
}

void ofApp::draw(){
	if(render) { // Render and denoise the scene
		{ // Update the camera transformation matrix, this matrix transforms the camera to its position, the inverse of the matrix transforms a worldspace point to a camera space point.
			cameraMatrix = ofMatrix4x4::newRotationMatrix(rotation.x * 180/PI, ofVec3f(1.0, 0.0, 0.0), rotation.y * 180/PI, ofVec3f(0.0, 1.0, 0.0), rotation.z * 180/PI, ofVec3f(0.0, 0.0, 1.0)) * ofMatrix4x4::newTranslationMatrix(position);
		}

		renderHistory.begin(); // First begin to use the renderHistory fbo. This fbo is for the ray tracer to render a full image and pass to the denoiser
			rayTracer.begin(); // Begin using the ray tracer shader
				rayTracer.setUniform2i("iResolution", ofGetWindowWidth(), ofGetWindowHeight()); // Pass in all of the variables we'll need
				rayTracer.setUniform1i("samples", samples);
				rayTracer.setUniform1f("focalLength", 0.5 * tan((90 - fov / 2) * PI / 180));
				rayTracer.setUniform1i("frameCount", ofGetFrameNum());
				rayTracer.setUniformMatrix4f("cameraMatrix", cameraMatrix);
				rayTracer.setUniform3i("sceneSize", sceneWidth, sceneLength, sceneHeight);
				rayTracer.setUniform1i("maxSteps", (int)maxSteps);
				rayTracer.setUniform1i("octreeDepth", octreeDepth);
				rayTracer.setUniform1i("render", (int) render);
				ofDrawRectangle(0, 0, ofGetWidth(), ofGetHeight()); // Then render a full screen rectangle to draw the shader over the whole screen
			rayTracer.end();
		renderHistory.end();

		bool doubleBufferSwitch = ofGetFrameNum() % 2 == 0;
		ofTexture pastFrameTextureRef;
		ofTexture pastFrameDepthTextureRef;
		
		if(doubleBufferSwitch) { // Then begin to use the pastFrame fbo. This fbo is for the denoiser to denoise the rendered image, currently only using temporal reprojection
			pastFrame.begin();
			pastFrameTextureRef = pastFrameCopy.getTextureReference(0);
			pastFrameDepthTextureRef = pastFrameCopy.getDepthTexture();
		} else {
			pastFrameCopy.begin();
			pastFrameTextureRef = pastFrame.getTextureReference(0);
			pastFrameDepthTextureRef = pastFrame.getDepthTexture();
		}
			denoiser.begin();
				denoiser.setUniform2f("iResolution", ofGetWindowWidth(), ofGetWindowHeight());
				denoiser.setUniform1f("reproPercent", reproPercent);
				denoiser.setUniformMatrix4f("invPastCameraMatrix", pastCameraMatrix.getInverse());
				denoiser.setUniformMatrix4f("cameraMatrix", cameraMatrix);
				denoiser.setUniformTexture("renderedFrame", renderHistory.getTextureReference(0), 0);
				// denoiser.setUniformTexture("renderedFrameNormals", renderHistory.getTextureReference(1), 0);
				denoiser.setUniformTexture("renderedFrameDepth", renderHistory.getDepthTexture(), 2);
				denoiser.setUniformTexture("pastFrame", pastFrameTextureRef, 1);
				denoiser.setUniformTexture("pastFrameDepth", pastFrameDepthTextureRef, 3);
				denoiser.setUniform1f("focalLength", 0.5 * tan((90 - fov / 2) * PI / 180));
				denoiser.setUniform1i("frameCount", ofGetFrameNum());
				ofDrawRectangle(0, 0, ofGetWidth(), ofGetHeight());
			denoiser.end();
		if(doubleBufferSwitch) {
			pastFrame.end();
		} else {
			pastFrameCopy.end();
		}

		pastCameraMatrix = cameraMatrix; // Store the cameras position and rotation for the denoiser to use in the next frame to reproject
	}

	pastFrame.draw(0, 0);


	{ // render gui
		gui.draw();
		samples = round(samples);
		maxSteps = round(maxSteps);
		label = std::string(to_string(ofGetLastFrameTime() * 1000)).substr(0, 3) + " ms";
		fps = std::string(to_string(ofGetFrameRate())) + "fps";
		if (reload) {
			rayTracer.load("shaders/tracer");
			denoiser.load("shaders/denoiser");
		}
	}
}

void ofApp::loadVoxelData(string p) {
	{ // load voxel information from file
		ofFile f;
		f.open(p, ofFile::ReadOnly);

		ofBuffer b = f.readToBuffer();

		vector <string> lines;

		for (auto line : b.getLines()) {
			lines.push_back(line);
		}

		sceneWidth = stoi(ofSplitString(lines[0], "x")[0]);
		sceneLength = stoi(ofSplitString(lines[0], "x")[2]);
		sceneHeight = stoi(ofSplitString(lines[0], "x")[1]);

		volumeData = new unsigned char[sceneWidth*sceneLength*sceneHeight * 4]; // volumeData is a flattened 3D array.

		for (int x = 0; x < sceneWidth; x++) {
			for (int y = 0; y < sceneLength; y++) {
				for (int z = 0; z < sceneHeight; z++) {
					char c[4] = { char(255), char(255), char(255), char(0) };
					setVoxel(x, y, z, c);
				}
			}
		}

		for (int i = 1; i < lines.size(); i++) {
			//Just load data in by splitting the string, definitely not as efficient as it could be
			//XYZ data
			int x = stoi(ofSplitString(lines[i], ",")[0]); //UGLY
			int y = stoi(ofSplitString(lines[i], ",")[2]);
			int z = stoi(ofSplitString(lines[i], ",")[1]);

			//RGB data
			int r = stoi(ofSplitString(lines[i], ",")[3]);
			int g = stoi(ofSplitString(lines[i], ",")[4]);
			int b = stoi(ofSplitString(lines[i], ",")[5]); //I would like to apologize for my rude statement about this code, every piece of code is unique and bueatiful in its own way

			char c[4] = { r, g, b, char(255) };

			setVoxel(x, y, z, c);
		}
	}

	//Generate a 3d texture holding the scene so it can be accessed using the graphics card
	genSceneTexture();
}

void ofApp::genWorld() { // Generate a scene using perlin noise
	sceneWidth = 512;
	sceneLength = 512;
	sceneHeight = 128;

	volumeData = new unsigned char[sceneWidth*sceneLength*sceneHeight * 4];

	for (int x = 0; x < sceneWidth; x++) {
		for (int y = 0; y < sceneLength; y++) {
			for (int z = 0; z < sceneHeight; z++) {
				char c[4] = { char(255), char(255), char(255), char(0) };
				setVoxel(x, y, z, c);
			}
		}
	}

	for (int x = 0; x < sceneWidth; x++) {
		for (int y = 0; y < sceneLength; y++) {
			float height = ofNoise((float)x * freq, (float)y * freq) * ofNoise((float)x * freq * 0.5, (float)y * freq * 0.5);
			for (int z = 0; z < height * sceneHeight; z++) {
				char c[4] = { char(125), char(125), char(125), char(255) };
				setVoxel(x, y, z, c);
			}
		}
	}

	octreeDepth = floor(log2(min(sceneWidth, min(sceneLength, sceneHeight))));

	genSceneTexture();
}

void ofApp::genSceneTexture() { // create 3D texture, load voxel data into it, and create mipmaps
		glGenTextures(1, &scene);
		glBindTexture(GL_TEXTURE_3D, scene);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_NEAREST_MIPMAP_NEAREST); //UPDATE THIS FOR MIPMAPPING OCTREE
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MAG_FILTER, GL_NEAREST_MIPMAP_NEAREST);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_BASE_LEVEL, 0);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MAX_LEVEL, octreeDepth - 1);
		glTexImage3D(GL_TEXTURE_3D, 0, GL_RGBA32F, sceneWidth, sceneLength, sceneHeight, 0, GL_RGBA, GL_UNSIGNED_BYTE, volumeData);
		glGenerateMipmap(GL_TEXTURE_3D);
}

void ofApp::setVoxel(int x, int y, int z, char c[4]) { // Set the data of a voxel at a given position
	int p = ((x + sceneWidth * y) + z * sceneWidth*sceneLength) * 4;

	volumeData[p] = c[0];
	volumeData[p + 1] = c[1];
	volumeData[p + 2] = c[2];
	volumeData[p + 3] = c[3];
}

void ofApp::reloadFBO() { // Reload the framebuffers, this needs to be called every time the resolution changes
	{ // Create the renderHistory fbo
		ofFboSettings settings;

		settings.width = ofGetWidth();
		settings.height = ofGetHeight();
		settings.useDepth = true; // Enable the depth texture
		settings.depthStencilAsTexture = true; // Store depth as a depth texture not as a buffer
		settings.useStencil = true; // Enable the stencil so we can use floating points for the depth
		settings.internalformat = GL_RGBA32F_ARB; // Use floating point colors because why not
		settings.textureTarget = GL_TEXTURE_2D;
		settings.depthStencilInternalFormat = GL_DEPTH32F_STENCIL8; // Use floating point depth for extra precision

		renderHistory.allocate(settings); // Create the frame buffer object

		renderHistory.begin();  // Clear the object
			ofClear(255, 0, 0, 0);
		renderHistory.end();
	}

	{ // Create the pastFrame fbo
		ofFbo::Settings settings;

		settings.width = ofGetWidth();
		settings.height = ofGetHeight();
		settings.useDepth = true;
		settings.depthStencilAsTexture = true;
		settings.useStencil = true;
		settings.internalformat = GL_RGBA32F_ARB;
		settings.depthStencilInternalFormat = GL_DEPTH32F_STENCIL8;

		pastFrame.allocate(settings);

		pastFrame.begin();
			ofClear(255, 0, 0, 0);
		pastFrame.end();
	}

	{ // Create the pastFrame fbo
		ofFbo::Settings settings;

		settings.width = ofGetWidth();
		settings.height = ofGetHeight();
		settings.useDepth = true;
		settings.depthStencilAsTexture = true;
		settings.useStencil = true;
		settings.internalformat = GL_RGBA32F_ARB;
		settings.depthStencilInternalFormat = GL_DEPTH32F_STENCIL8;

		pastFrameCopy.allocate(settings);

		pastFrameCopy.begin();
			ofClear(255, 0, 0, 0);
		pastFrameCopy.end();
	}
}

void ofApp::keyPressed(int key) {
	if (key == 'a') { // Movement
		input.x = -1;
	}
	else if (key == 's') {
		input.x = 1;
	}
	else if (key == 'w') {
		input.y = 1;
	}
	else if (key == 'r') {
		input.y = -1;
	}
	else if (key == ' ') {
		input.z = 1;
	}
	else if (key == 'c') {
		input.z = -1;
	}
	else if (key == 'f') { // Lock mouse for fps style camera
		lockMouse = !lockMouse;
		if (lockMouse) {
			ofHideCursor();
		}
		else {
			ofShowCursor();
		}
	}
	else if (key == 'p') { // Toggle render
		render = !render;
	}
	else if (key == 'g') { // Take screenshot
		img.grabScreen(0, 0, ofGetWidth(), ofGetHeight());
		img.save("screenshot.png");
	}
}

void ofApp::keyReleased(int key) {
	if (key == 'a') {
		input.x = 0;
	}
	else if (key == 's') {
		input.x = 0;
	}
	else if (key == 'w') {
		input.y = 0;
	}
	else if (key == 'r') {
		input.y = 0;
	}
	else if (key == ' ') {
		input.z = 0;
	}
	else if (key == 'c') {
		input.z = 0;
	}
}

void ofApp::mouseMoved(int x, int y ) {
	#ifdef _WIN64 // FPS style locked camera only works on windows :(
	if (lockMouse) {
		rotation.z -= (x-ofGetWindowWidth()/2) * sensitivity;
		rotation.x -= (y-ofGetWindowHeight()/2) * sensitivity;
		SetCursorPos(ofGetWindowPositionX() + ofGetWindowWidth()/2, ofGetWindowPositionY() + ofGetWindowHeight()/2);
	}
	#endif
	lastmousex = x;
	lastmousey = y;
}


void ofApp::mouseDragged(int x, int y, int button) {
	rotation.z -= (x - lastmousex) * dragsensitivity;
	rotation.x -= (y - lastmousey) * dragsensitivity; 
	lastmousex = x;
	lastmousey = y;
}

void ofApp::mousePressed(int x, int y, int button){

}

void ofApp::mouseReleased(int x, int y, int button){
	
}

void ofApp::mouseEntered(int x, int y){
	
}

void ofApp::mouseExited(int x, int y){

}

void ofApp::windowResized(int w, int h) {
	reloadFBO(); // Resize the frame buffer objects
}

void ofApp::gotMessage(ofMessage msg){

}

void ofApp::dragEvent(ofDragInfo dragInfo){ 

}
