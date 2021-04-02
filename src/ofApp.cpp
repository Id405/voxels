#include "ofApp.h"

void ofApp::setup(){
	ofBackground(255, 125, 90);
	ofSetVerticalSync(false);

	position.set(-20, -20, 48);
	rotation.set(-0.4, 0, -0.8);

	gui.setup();
	gui.add(samples.setup("samples", 10, 1, 200));
	gui.add(label.setup("frametime", "initializing", 200, 25));
	gui.add(button.setup("reload shaders", 200, 25));

	shader.load("shaders/tracer");
	loadVoxelData("scenes/garfield.evox");
}

void ofApp::update(){
	ofVec3f rotatedInput = input.getRotatedRad(0, 0, rotation.z);
	position += rotatedInput * ofGetLastFrameTime() * moveSpeed;
}

void ofApp::draw(){
	if(render) { // render GLSL shader with ray tracing information
		ofSetColor(255);
		shader.begin();
		shader.setUniform2f("iResolution", ofGetWindowWidth(), ofGetWindowHeight());
		shader.setUniform1f("samples", (float) samples);
		shader.setUniform1f("fov", 0.5 * tan((90 - fov / 2) * PI / 180));
		shader.setUniform1f("frameCount", (float)ofGetFrameNum());
		shader.setUniform3f("transl", position);
		shader.setUniform3f("rotation", rotation);
		shader.setUniform3i("sceneSize", sceneWidth, sceneLength, sceneHeight);
		shader.setUniform1i("maxSteps", maxSteps);
		shader.setUniform1i("octreeDepth", octreeDepth);
		glBindTexture(GL_TEXTURE_3D, scene);
		ofDrawRectangle(0, 0, ofGetWidth(), ofGetHeight());
		shader.end();
	}

	{ // render gui
		gui.draw();
		samples = round(samples);
		label = std::string(to_string(ofGetLastFrameTime() * 1000)).substr(0, 3) + " ms";
		if (button) {
			shader.load("shaders/tracer");
			// button = false;
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
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_S, GL_REPEAT);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_T, GL_REPEAT);
		glTexParameteri(GL_TEXTURE_3D, GL_TEXTURE_WRAP_R, GL_REPEAT);
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

}

void ofApp::gotMessage(ofMessage msg){

}

void ofApp::dragEvent(ofDragInfo dragInfo){ 

}
