#pragma once

#include "ofMain.h"
#include "ofxGui.h"
#include "ofxVolumetrics.h"

class ofApp : public ofBaseApp{

	public:
		void setup();
		void update();
		void draw();

		void keyPressed(int key);
		void keyReleased(int key);
		void mouseMoved(int x, int y );
		void mouseDragged(int x, int y, int button);
		void mousePressed(int x, int y, int button);
		void mouseReleased(int x, int y, int button);
		void mouseEntered(int x, int y);
		void mouseExited(int x, int y);
		void windowResized(int w, int h);
		void dragEvent(ofDragInfo dragInfo);
		void gotMessage(ofMessage msg);

		void loadVoxelData(string p);
		void setVoxel(int x, int y, int z, char c[4]);
		
		ofShader shader;
		ofxPanel gui;
		ofxFloatSlider samples;
		ofxLabel label;
		ofxButton button;
		unsigned int scene;
		unsigned char * volumeData;

		ofVec3f input;
		ofVec3f position;
		bool lockMouse = false;
		bool render = true;
		ofVec3f rotation;
		int lastmousex;
		int lastmousey;

		float fov = 90;
		float moveSpeed = 40;
		float sensitivity = 0.0006;
		float dragsensitivity= 0.001;

		int sceneWidth = 16;
		int sceneLength = 16;
		int sceneHeight = 16;

		// int samples = 15;
		int maxSteps = 256;
		int octreeDepth = 4;
};
