#include "ofApp.h"

void ofApp::setup(){
	// ofBackground(255, 125, 90);
	ofDisableArbTex();
	glEnable(GL_DEPTH_TEST);
	glDepthFunc(GL_ALWAYS);
	ofSetVerticalSync(false);

	blueNoise.load("textures/LDR_RGBA_0.png");
	blueNoise.getTexture().setTextureWrap(GL_REPEAT, GL_REPEAT);

	// position.set(-20, -20, 48);
	// rotation.set(-0.4, 0, -0.8);

	rayTracer.load("shaders/tracer");
	denoiser.load("shaders/denoiser");
	loadVoxelData("scenes/garfield.evox");
	
	{
		mesh.setMode(OF_PRIMITIVE_TRIANGLE_STRIP);
		mesh.addVertex(ofPoint(0, 0));
		mesh.addVertex(ofPoint(0, 0));
		mesh.addVertex(ofPoint(0, 0));
		mesh.addVertex(ofPoint(0, 0));
	}

	{
		gui.setup();
		gui.add(samples.setup("samples", 10, 1, 200));
		gui.add(maxSteps.setup("max steps", 200, 50, 256));
		gui.add(reproPercent.setup("reprojection percent", 0.9, 0, 1));
		gui.add(label.setup("frametime", "initializing", 200, 25));
		gui.add(fps.setup("fps", "initializing", 200, 25));
		gui.add(reload.setup("reload shaders", 200, 25));
	}

	reloadFBO();
}

void ofApp::update(){
	ofVec3f rotatedInput = input.getRotatedRad(0, 0, rotation.z);
	position += rotatedInput * ofGetLastFrameTime() * moveSpeed;

	{
		cameraMatrix = ofMatrix4x4::newRotationMatrix(rotation.x * 180/PI, ofVec3f(1.0, 0.0, 0.0), rotation.y * 180/PI, ofVec3f(0.0, 1.0, 0.0), rotation.z * 180/PI, ofVec3f(0.0, 0.0, 1.0)) * ofMatrix4x4::newTranslationMatrix(position);
	}
}

void ofApp::draw(){
	if(render) {
		renderHistory.begin();
			rayTracer.begin();
				rayTracer.setUniform2f("iResolution", ofGetWindowWidth(), ofGetWindowHeight());
				rayTracer.setUniform1f("samples", (float) samples);
				rayTracer.setUniform1f("fov", 0.5 * tan((90 - fov / 2) * PI / 180));
				rayTracer.setUniform1f("frameCount", (float)ofGetFrameNum());
				rayTracer.setUniformMatrix4f("cameraMatrix", cameraMatrix);
				rayTracer.setUniform3i("sceneSize", sceneWidth, sceneLength, sceneHeight);
				rayTracer.setUniform1i("maxSteps", (int)maxSteps);
				rayTracer.setUniform1i("octreeDepth", octreeDepth);
				rayTracer.setUniformTexture("blueNoise", blueNoise.getTexture(), 0);
				ofDrawRectangle(0, 0, ofGetWidth(), ofGetHeight());
			rayTracer.end();
		renderHistory.end();

		pastFrame.begin();
			denoiser.begin();
			denoiser.setUniform2f("iResolution", ofGetWindowWidth(), ofGetWindowHeight());
			denoiser.setUniform1f("reproPercent", reproPercent);
			denoiser.setUniformMatrix4f("invPastCameraMatrix", pastCameraMatrix.getInverse());
			denoiser.setUniformMatrix4f("cameraMatrix", cameraMatrix);
			denoiser.setUniformTexture("renderedFrame", renderHistory.getTextureReference(0), 0);
			denoiser.setUniformTexture("renderedFrameDepth", renderHistory.getDepthTexture(), 2);
			denoiser.setUniformTexture("pastFrame", pastFrame.getTextureReference(0), 1);
			denoiser.setUniform1f("fov", 0.5 * tan((90 - fov / 2) * PI / 180));
			denoiser.setUniform1i("frameCount", ofGetFrameNum());
			mesh.draw();
			denoiser.end();
		pastFrame.end();

		pastFrame.draw(0, 0);
		// renderHistory.getDepthTexture().draw(0, 0);

		pastCameraMatrix = cameraMatrix;
		// renderHistory.draw(0, 0);
	}

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
	{ // load voxel information from filee
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

		volumeData = new unsigned char[sceneWidth*sceneLength*sceneHeight * 4];

		for (int x = 0; x < sceneWidth; x++) {
			for (int y = 0; y < sceneLength; y++) {
				for (int z = 0; z < sceneHeight; z++) {
					char c[4] = { char(255), char(255), char(255), char(0) };
					setVoxel(x, y, z, c);
				}
			}
		}

		for (int i = 1; i < lines.size(); i++) {
			//Just load data in by splitting the string, definately not as efficient as it could be
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

	{ // create 3D texture, load voxel data into it, and create mipmaps
		glGenTextures(1, &scene);
		glBindTexture(GL_TEXTURE_3D, scene);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MIN_FILTER, GL_NEAREST_MIPMAP_NEAREST); //UPDATE THIS FOR MIPMAPPING OCTREE
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MAG_FILTER, GL_NEAREST_MIPMAP_NEAREST);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, GL_CLAMP_TO_EDGE);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_BASE_LEVEL, 0);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_MAX_LEVEL, octreeDepth - 1);
		glTexImage3D(GL_TEXTURE_3D, 0, GL_RGBA8, sceneWidth, sceneLength, sceneHeight, 0, GL_RGBA, GL_UNSIGNED_BYTE, volumeData);
		glGenerateMipmap(GL_TEXTURE_3D);
	}
}

void ofApp::setVoxel(int x, int y, int z, char c[4]) {
	int p = ((x + sceneWidth * y) + z * sceneWidth*sceneLength) * 4;

	volumeData[p] = c[0];
	volumeData[p + 1] = c[1];
	volumeData[p + 2] = c[2];
	volumeData[p + 3] = c[3];
}

void ofApp::reloadFBO() {

	ofFbo::Settings settings;

	settings.width = ofGetWidth();
	settings.height = ofGetHeight();
	settings.useDepth = true;
	settings.depthStencilAsTexture = true;
	settings.depthStencilInternalFormat = GL_DEPTH_COMPONENT32;

	renderHistory.allocate(settings);

	renderHistory.begin();
		ofClear(255, 0, 0, 0);
	renderHistory.end();

	{
		pastFrame.allocate(ofGetWidth(), ofGetHeight(), GL_RGBA32F_ARB);

		pastFrame.begin();
			ofClear(255, 0, 0, 0);
		pastFrame.end();
	}
}

void ofApp::keyPressed(int key){
	if (key == 'a') {
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
	else if (key == 'f') {
		lockMouse = !lockMouse;
		if (lockMouse) {
			ofHideCursor();
		}
		else {
			ofShowCursor();
		}
	}
	else if (key == 'p') {
		render = !render;
	}
	else if (key == 'g') {
		img.grabScreen(0, 0, ofGetWidth(), ofGetHeight());
		img.save("screenshot.png");
	}
}

void ofApp::keyReleased(int key){
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

void ofApp::mouseMoved(int x, int y ){
	#ifdef _WIN64
	if (lockMouse) {
		rotation.z -= (x-ofGetWindowWidth()/2) * sensitivity;
		rotation.x -= (y-ofGetWindowHeight()/2) * sensitivity;
		SetCursorPos(ofGetWindowPositionX() + ofGetWindowWidth()/2, ofGetWindowPositionY() + ofGetWindowHeight()/2);
	}
	#endif
	lastmousex = x;
	lastmousey = y;
}


void ofApp::mouseDragged(int x, int y, int button){
	#ifdef __linux__
	rotation.z -= (x - lastmousex) * dragsensitivity;
	rotation.x -= (y - lastmousey) * dragsensitivity; 
	lastmousex = x;
	lastmousey = y;
	#endif
}

void ofApp::mousePressed(int x, int y, int button){

}

void ofApp::mouseReleased(int x, int y, int button){
	
}

void ofApp::mouseEntered(int x, int y){
	
}

void ofApp::mouseExited(int x, int y){

}

void ofApp::windowResized(int w, int h){
	reloadFBO();
}

void ofApp::gotMessage(ofMessage msg){

}

void ofApp::dragEvent(ofDragInfo dragInfo){ 

}

// Graveyard
// {
// 	glGenFramebuffers(1, &renderHistory);
// 	glBindFramebuffer(GL_FRAMEBUFFER, renderHistory);

// 	glGenTextures(1, &renderHistoryTexture);
// 	glBindTexture(GL_TEXTURE_2D, renderHistoryTexture);

// 	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, ofGetWindowWidth(), ofGetWindowHeight(), 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);

// 	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
// 	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

// 	glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, renderHistory, 0);
// }
