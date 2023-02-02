import React from 'react';
import cornerstone from 'cornerstone-core';
import { View2D, getImageData, loadImageData, vtkSVGRotatableCrosshairsWidget,
  vtkInteractorStyleRotatableMPRCrosshairs, } from '@vtk-viewport';
import vtkHttpDataSetReader from '@kitware/vtk.js/IO/Core/HttpDataSetReader';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkMatrixBuilder from '@kitware/vtk.js/Common/Core/MatrixBuilder';
import vtkOBJReader from '@kitware/vtk.js/IO/Misc/OBJReader';
import vtkMTLReader from '@kitware/vtk.js/IO/Misc/MTLReader';

const USE_DICOM_TEST_DATA = false;

const ROOT_URL =
  window.location.hostname === 'localhost'
    ? window.location.host
    : window.location.hostname;

const loadDataFromVtiSample = async dataUrl => {
  const reader = vtkHttpDataSetReader.newInstance({
    fetchGzip: true,
  });

  await reader.setUrl('/headsq.vti', { loadData: true });
  return reader.getOutputData();
};

const loadDataFromDicomSample = async () => {
  const imageIds = [];
  for (let i = 0; i < 240; i++) {
    imageIds.push(`dicomweb://${ROOT_URL}/data/contours/ct/ct(${i + 1}).dcm`);
  }

  const promises = imageIds.map(imageId => {
    return cornerstone.loadAndCacheImage(imageId);
  });

  const imageDataObject = await Promise.all(promises).then(() => {
    const displaySetInstanceUid = '12345';
    return getImageData(imageIds, displaySetInstanceUid);
  });

  const onPixelDataInsertedCallback = numberProcessed => {
    const percentComplete = Math.floor(
      (numberProcessed * 100) / imageIds.length
    );

    console.log(`Processing: ${percentComplete}%`);
  };

  imageDataObject.onPixelDataInserted(onPixelDataInsertedCallback);
  loadImageData(imageDataObject);

  return imageDataObject;
};

const loadContourRoiMeshes = async () => {
  const dataRoot = '/data/contours/surfaces';
  const roiNames = [
    'BODY',
    'coronal',
    'mixed',
    'Saggital',
    'Trans',
  ];
  const roiUrls = roiNames.map(roiName => `${dataRoot}/${roiName}.obj`);

  const loadMesh = async function(objUrl, i) {
    const mtl = objUrl.replace(/\.obj$/, '.mtl');
    const reader = vtkOBJReader.newInstance({ splitMode: 'usemtl' });
    const materialsReader = vtkMTLReader.newInstance();
    await materialsReader.setUrl(mtl);
    await reader.setUrl(objUrl);
    const polyData = reader.getOutputData();
    const material = materialsReader.getMaterial(polyData.get('name').name);
    const opacity = material.d ? Number(material.d) : 1;
    const color = material.Kd ? material.Kd.map(i => Number(i)) : [1, 1, 1];
    color.push(opacity);
    return { polyData, color, uid: roiNames[i] };
  };

  const promises = roiUrls.map(loadMesh);
  return await Promise.all(promises).then(data => {
    const contourRois = {};
    data.forEach(item => {
      contourRois[item.uid] = { polyData: item.polyData, color: item.color };
    });
    return contourRois;
  });
};

class ContourMPRRenderingExample extends React.Component {
  state = {
    volumes: [],
    contourRois: {},
  };

  async componentDidMount() {
    this.apis = [];

    const volumeActor = vtkVolume.newInstance();
    const volumeMapper = vtkVolumeMapper.newInstance();

    volumeActor.setMapper(volumeMapper);

    if (USE_DICOM_TEST_DATA) {
      const imageDataObject = await loadDataFromDicomSample();
      volumeMapper.setInputData(imageDataObject.vtkImageData);

      const windowWidth = 350;
      const windowCenter = 50;
      const low = windowCenter - windowWidth / 2;
      const high = windowCenter + windowWidth / 2;
      const rgbTransferFunction = volumeActor
        .getProperty()
        .getRGBTransferFunction(0);
      rgbTransferFunction.setMappingRange(low, high);

      const contourRois = await loadContourRoiMeshes();

      this.setState({
        volumes: [volumeActor],
        contourRois,
      });
    } else {
      // Load VTI data
      const data = await loadDataFromVtiSample('/headsq.vti');
      volumeMapper.setInputData(data);

      const windowWidth = 1000;
      const windowCenter = 300 + 1024; // vti data - translate windowCenter
      const low = windowCenter - windowWidth / 2;
      const high = windowCenter + windowWidth / 2;
      const rgbTransferFunction = volumeActor
        .getProperty()
        .getRGBTransferFunction(0);
      rgbTransferFunction.setMappingRange(low, high);

      const testContourRois = this.createTestContourRois(data);

      this.setState({
        volumes: [volumeActor],
        contourRois: testContourRois,
      });
    }
  }

  createTestContourRois(data) {
    const roiParameters = [
      {
        id: 'body',
        color: [0, 1, 0],
        contourValue: 1024 - 100,
      },
      {
        id: 'bone',
        color: [0.88, 0.25, 0.28],
        contourValue: 1024 + 400,
      },
    ];

    const contourRois = {};
    roiParameters.forEach(paras => {
      const mCubes = vtkImageMarchingCubes.newInstance({
        contourValue: paras.contourValue,
      });
      mCubes.setInputData(data);
      mCubes.update();
      const polyData = mCubes.getOutputData();
      const transform = vtkMatrixBuilder
        .buildFromRadian()
        .identity()
        .rotateFromDirections([1, 0, 0, 0, 1, 0, 0, 0, 1], data.getDirection());
      transform.apply(polyData.getPoints().getData());
      contourRois[paras.id] = { polyData, color: paras.color };
    });

    return contourRois;
  }

  updateAllViewports = () => {
    Object.keys(this.apis).forEach(viewportIndex => {
      const api = this.apis[viewportIndex];

      api.genericRenderWindow.getRenderWindow().render();
    });
  };

  saveRenderWindow = viewportIndex => {
    return api => {
      this.apis[viewportIndex] = api;
      const apis = this.apis;

      // It is up to the layout manager to know the number of viewports
      // if (apis.length === 3) {
      //   apis.forEach((api, index) => {
      //     api.svgWidgets.rotatableCrosshairsWidget.setApiIndex(index);
      //     api.svgWidgets.rotatableCrosshairsWidget.setApis(apis);
      //   });
      //
      //
      // }
      if (apis.length === 3) {
        apis.forEach((api, index) => {
          const renderWindow = api.genericRenderWindow.getRenderWindow();

          // Add Rotatable Crosshairs
          api.addSVGWidget(
            vtkSVGRotatableCrosshairsWidget.newInstance(),
            'rotatableCrosshairsWidget'
          );
          api.svgWidgets.rotatableCrosshairsWidget.setApiIndex(index);
          api.svgWidgets.rotatableCrosshairsWidget.setApis(apis);

          const iStyle = vtkInteractorStyleRotatableMPRCrosshairs.newInstance();
          // if (iStyle.setApis && iStyle.setApiIndex) {
          //   iStyle.setApis(this.apis);
          //   iStyle.setApiIndex(index);
          // }

          api.setInteractorStyle({
            istyle: iStyle,
            configuration: {
              apis,
              apiIndex: viewportIndex,
            },
          });

          renderWindow.render();
        });

        apis[0].svgWidgets.rotatableCrosshairsWidget.resetCrosshairs(apis, 0);
      }

      window.apis = apis;
    };
  };

  resetCrosshairs = () => {
    const apis = this.apis;

    apis.forEach(api => {
      api.resetOrientation();
    });

    // Reset the crosshairs
    apis[0].svgWidgets.rotatableCrosshairsWidget.resetCrosshairs(apis, 0);
  };

  render() {
    if (!this.state.volumes || !this.state.volumes.length) {
      return <h4>Loading...</h4>;
    }

    return (
      <React.Fragment>
        <div className="row">
          <div className="col-xs-12">
            <p>This example demonstrates contour rendering in 3D MPR.</p>
          </div>
          <div className="col-xs-4">
            <button onClick={this.resetCrosshairs}>Reset crosshairs</button>
          </div>
        </div>
        <div className="row">
          <div className="col-sm-4">
            <View2D
              volumes={this.state.volumes}
              contourRois={this.state.contourRois}
              onCreated={this.saveRenderWindow(0)}
              orientation={{ sliceNormal: [0, 0, 1], viewUp: [0, -1, 0] }}
              showRotation={true}
            />
          </div>
          <div className="col-sm-4">
            <View2D
              volumes={this.state.volumes}
              contourRois={this.state.contourRois}
              onCreated={this.saveRenderWindow(1)}
              orientation={{ sliceNormal: [1, 0, 0], viewUp: [0, 0, -1] }}
              showRotation={true}
            />
          </div>
          <div className="col-sm-4">
            <View2D
              volumes={this.state.volumes}
              contourRois={this.state.contourRois}
              onCreated={this.saveRenderWindow(2)}
              orientation={{ sliceNormal: [0, 1, 0], viewUp: [0, 0, -1] }}
              showRotation={true}
            />
          </div>
        </div>
      </React.Fragment>
    );
  }
}

export default ContourMPRRenderingExample;
