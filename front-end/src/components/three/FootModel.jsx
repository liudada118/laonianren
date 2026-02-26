import React, { useEffect, useRef } from 'react'
import * as THREE from 'three'

export function FootModel({ isRecording = false, pressureData = null }) {
  const containerRef = useRef(null)
  const sceneRef = useRef(null)
  const rendererRef = useRef(null)
  const animationRef = useRef(null)
  const feetGroupRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current) return

    // Scene setup
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xBCC6D0)
    sceneRef.current = scene

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      45,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    )
    camera.position.set(0, 4, 4)
    camera.lookAt(0, 0, 0)

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.shadowMap.enabled = true
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(5, 10, 5)
    directionalLight.castShadow = true
    scene.add(directionalLight)

    // Create feet group
    const feetGroup = new THREE.Group()
    feetGroupRef.current = feetGroup

    // Foot shape function
    const createFoot = (isLeft) => {
      const footGroup = new THREE.Group()
      
      // Main foot body
      const footShape = new THREE.Shape()
      footShape.moveTo(-0.3, -0.6)
      footShape.quadraticCurveTo(-0.35, 0, -0.25, 0.5)
      footShape.quadraticCurveTo(-0.1, 0.7, 0.1, 0.7)
      footShape.quadraticCurveTo(0.3, 0.65, 0.35, 0.4)
      footShape.quadraticCurveTo(0.4, 0, 0.35, -0.5)
      footShape.quadraticCurveTo(0.2, -0.7, 0, -0.7)
      footShape.quadraticCurveTo(-0.2, -0.65, -0.3, -0.6)

      const extrudeSettings = {
        steps: 1,
        depth: 0.15,
        bevelEnabled: true,
        bevelThickness: 0.05,
        bevelSize: 0.05,
        bevelSegments: 3
      }

      const footGeometry = new THREE.ExtrudeGeometry(footShape, extrudeSettings)
      const footMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xE8D4C4,
        roughness: 0.7,
        metalness: 0.1
      })
      const foot = new THREE.Mesh(footGeometry, footMaterial)
      foot.rotation.x = -Math.PI / 2
      foot.castShadow = true
      footGroup.add(foot)

      // Pressure points
      const pressurePoints = [
        { x: 0, y: 0.5, name: 'toe' },
        { x: 0, y: 0, name: 'mid' },
        { x: 0, y: -0.4, name: 'heel' },
      ]

      pressurePoints.forEach(point => {
        const indicatorGeometry = new THREE.SphereGeometry(0.08, 16, 16)
        const indicatorMaterial = new THREE.MeshBasicMaterial({ 
          color: 0x3B82F6,
          transparent: true,
          opacity: 0.6
        })
        const indicator = new THREE.Mesh(indicatorGeometry, indicatorMaterial)
        indicator.position.set(point.x, 0.15, point.y)
        indicator.name = `pressure_${point.name}`
        footGroup.add(indicator)
      })

      if (!isLeft) {
        footGroup.scale.x = -1
      }

      return footGroup
    }

    // Create left and right feet
    const leftFoot = createFoot(true)
    leftFoot.position.set(-0.6, 0, 0)
    leftFoot.name = 'leftFoot'
    feetGroup.add(leftFoot)

    const rightFoot = createFoot(false)
    rightFoot.position.set(0.6, 0, 0)
    rightFoot.name = 'rightFoot'
    feetGroup.add(rightFoot)

    scene.add(feetGroup)

    // Platform
    const platformGeometry = new THREE.BoxGeometry(3, 0.1, 2)
    const platformMaterial = new THREE.MeshStandardMaterial({ 
      color: 0x4B5563,
      roughness: 0.8
    })
    const platform = new THREE.Mesh(platformGeometry, platformMaterial)
    platform.position.set(0, -0.05, 0)
    platform.receiveShadow = true
    scene.add(platform)

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 20, 0xffffff, 0xffffff)
    gridHelper.material.opacity = 0.1
    gridHelper.material.transparent = true
    gridHelper.position.y = -0.1
    scene.add(gridHelper)

    // Animation loop
    let time = 0
    const animate = () => {
      animationRef.current = requestAnimationFrame(animate)
      time += 0.02

      if (isRecording && feetGroupRef.current) {
        // Simulate pressure changes
        const leftFoot = feetGroupRef.current.getObjectByName('leftFoot')
        const rightFoot = feetGroupRef.current.getObjectByName('rightFoot')

        ;[leftFoot, rightFoot].forEach((foot, idx) => {
          if (foot) {
            ['toe', 'mid', 'heel'].forEach((part, i) => {
              const indicator = foot.getObjectByName(`pressure_${part}`)
              if (indicator) {
                const pressure = 0.5 + Math.sin(time * 2 + i + idx) * 0.3
                indicator.scale.setScalar(0.5 + pressure)
                
                // Color based on pressure
                const hue = 0.6 - pressure * 0.4
                indicator.material.color.setHSL(hue, 0.8, 0.5)
              }
            })
          }
        })
      }

      renderer.render(scene, camera)
    }
    animate()

    // Handle resize
    const handleResize = () => {
      if (!containerRef.current) return
      const width = containerRef.current.clientWidth
      const height = containerRef.current.clientHeight
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement)
        rendererRef.current.dispose()
      }
    }
  }, [isRecording])

  return (
    <div 
      ref={containerRef} 
      className="w-full h-full"
      style={{ minHeight: '400px' }}
    />
  )
}

export default FootModel
